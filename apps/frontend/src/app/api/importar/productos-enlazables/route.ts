import { NextResponse, type NextRequest } from 'next/server';

import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { loadEffectiveBusinessPrefs } from '@/lib/business-prefs/server';
import { MODULOS_ACCESO_LECTOR_FACTURAS } from '@/lib/modulos/modulo-key';
import { moduloGuardAny } from '@/lib/modulos/guard';
import { normalizarTextoBusqueda } from '@/lib/search/normalize-busqueda';
import type { Database } from '@/types/database';

type ProductoEnlazable = {
  id: string;
  codigo: string;
  nombre: string;
  iva_porcentaje: number | null;
  unidad: Database['public']['Enums']['unidad_medida'] | null;
  unidad_compra: Database['public']['Enums']['unidad_medida'] | null;
  contenido_unidad_compra: number | null;
  proveedor_id: string | null;
  proveedor_nombre: string | null;
  stock_actual: number | null;
  precio_costo: number | null;
  precio_venta: number | null;
};

type ProductoRow = {
  id: string;
  codigo: string;
  nombre: string;
  iva_porcentaje: number | null;
  unidad: Database['public']['Enums']['unidad_medida'] | null;
  unidad_compra: Database['public']['Enums']['unidad_medida'] | null;
  contenido_unidad_compra: number | null;
  proveedor_id: string | null;
  proveedor?: { id: string; nombre: string } | null;
  stock_actual: number | null;
  precio_costo: number | null;
  precio_venta: number | null;
};

const PROVEEDOR_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SELECT_PRODUCTO =
  'id, codigo, nombre, iva_porcentaje, unidad, unidad_compra, contenido_unidad_compra, proveedor_id, proveedor:proveedor_id(id, nombre), stock_actual, precio_costo, precio_venta';
const RESULT_LIMIT = 20;

function busquedaNormalizada(request: NextRequest): {
  raw: string;
  textoBuscable: string;
} {
  const raw = (request.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 80);
  const safe = raw.replace(/[,()%_\\'"]/g, ' ').replace(/\s+/g, ' ').trim();
  return {
    raw,
    textoBuscable: safe ? normalizarTextoBusqueda(safe) : '',
  };
}

function productoToPayload(row: ProductoRow): ProductoEnlazable {
  return {
    id: row.id,
    codigo: row.codigo,
    nombre: row.nombre,
    iva_porcentaje: row.iva_porcentaje,
    unidad: row.unidad,
    unidad_compra: row.unidad_compra,
    contenido_unidad_compra: row.contenido_unidad_compra,
    proveedor_id: row.proveedor_id,
    proveedor_nombre: row.proveedor?.nombre ?? null,
    stock_actual: row.stock_actual,
    precio_costo: row.precio_costo,
    precio_venta: row.precio_venta,
  };
}

function ordenarProductos(productos: ProductoEnlazable[], qRaw: string): ProductoEnlazable[] {
  const q = qRaw.trim().toLowerCase();
  return [...productos].sort((a, b) => {
    const aExact = q && a.codigo.trim().toLowerCase() === q ? 1 : 0;
    const bExact = q && b.codigo.trim().toLowerCase() === q ? 1 : 0;
    if (aExact !== bExact) return bExact - aExact;
    return a.nombre.localeCompare(b.nombre, 'es');
  });
}

export async function GET(request: NextRequest) {
  const guard = await moduloGuardAny([
    'importador_excel',
    'ia_precios',
    ...MODULOS_ACCESO_LECTOR_FACTURAS,
  ]);
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;
  const supabase = session.supabase;
  const tenantId = session.tenantId;

  const sucursalScope = await resolveAndValidateSucursalScope(session, null);
  if (!sucursalScope.ok) return sucursalScope.response;

  const { raw, textoBuscable } = busquedaNormalizada(request);
  if (!textoBuscable && raw.length < 2) {
    return NextResponse.json({ productos: [], alcance: 'vacio' });
  }

  const proveedorRaw = (request.nextUrl.searchParams.get('proveedor_id') ?? '').trim();
  const proveedorId = PROVEEDOR_UUID_RE.test(proveedorRaw) ? proveedorRaw : null;
  const sinProveedor = request.nextUrl.searchParams.get('sin_proveedor') === '1';

  const businessPrefs = await loadEffectiveBusinessPrefs(
    supabase,
    tenantId,
    sucursalScope.sucursalId,
  );
  const unificar = businessPrefs.unificarProductosEntreProveedores === true;

  const buildBaseQuery = () => {
    let q = session.supabase
      .from('producto')
      .select(SELECT_PRODUCTO)
      .eq('tenant_id', tenantId)
      .eq('activo', true);
    if (textoBuscable) {
      q = q.ilike('texto_buscable', `%${textoBuscable}%`);
    }
    return q.order('nombre').limit(RESULT_LIMIT);
  };

  async function fetchPrincipal(): Promise<ProductoEnlazable[]> {
    let q = buildBaseQuery();
    if (!unificar) {
      if (proveedorId) q = q.eq('proveedor_id', proveedorId);
      else if (sinProveedor) q = q.is('proveedor_id', null);
      else return [];
    }
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return ((data ?? []) as unknown as ProductoRow[]).map(productoToPayload);
  }

  try {
    const principal = await fetchPrincipal();
    const map = new Map<string, ProductoEnlazable>();
    for (const p of principal) map.set(p.id, p);
    const productos = ordenarProductos([...map.values()], raw).slice(0, RESULT_LIMIT);
    return NextResponse.json({
      productos,
      alcance: unificar ? 'todos_los_proveedores' : proveedorId ? 'proveedor' : 'sin_proveedor',
      unificar_productos_entre_proveedores: unificar,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'No se pudieron buscar productos' },
      { status: 500 },
    );
  }
}
