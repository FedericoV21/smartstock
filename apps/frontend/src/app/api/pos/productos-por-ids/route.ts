import { NextResponse } from 'next/server';

import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession } from '@/lib/api/tenant-session';
import { enriquecerProductosPosConSucursalCaja } from '@/lib/pos/enriquecer-productos-pos-sucursal-caja';
import type { ProductoRow } from '@/lib/pos/resolver-producto-barcode-pos';
import { enrichProductosPayloadConTramos } from '@/lib/productos/fetch-ganancia-tramos-batch';
import {
  etiquetaProductoConVariante,
  etiquetaVariante,
  fetchStockVariantePorIds,
} from '@/lib/productos/variantes';

const MAX_IDS = 200;

const SELECT_COLS =
  'id, codigo, nombre, precio_costo, precio_venta, porcentaje_ganancia, stock_actual, unidad, unidad_compra, contenido_unidad_compra, es_pesable, codigo_barras, plu, usa_variantes, iva_porcentaje, imagen_url, sucursal_id, rubro, subrubro, categoria:categoria_id(id, nombre), proveedor:proveedor_id(id, nombre)';

type SeleccionProductoPos = {
  producto_id: string;
  producto_variante_id: string | null;
};

function parseSelecciones(raw: unknown): SeleccionProductoPos[] {
  if (!Array.isArray(raw)) return [];
  const out: SeleccionProductoPos[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const productoId = typeof row.producto_id === 'string' ? row.producto_id.trim() : '';
    if (!productoId) continue;
    const varianteId =
      typeof row.producto_variante_id === 'string' && row.producto_variante_id.trim()
        ? row.producto_variante_id.trim()
        : null;
    const key = `${productoId}:${varianteId ?? 'base'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ producto_id: productoId, producto_variante_id: varianteId });
  }
  return out;
}

/**
 * Lotes de filas de producto para rehidratar el carrito del POS (precio, stock, nombre) tras
 * restaurar desde localStorage. Mismas columnas que `/api/pos/buscar-productos`.
 */
export async function POST(request: Request) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const { supabase, tenantId } = session;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const b =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const selecciones = parseSelecciones(b.selecciones);
  const raw = b.producto_ids;
  const idsLegacy = Array.isArray(raw)
    ? Array.from(
        new Set(
          raw
            .map((x) => (typeof x === 'string' ? x.trim() : ''))
            .filter((x) => x.length > 0),
        ),
      )
    : [];
  const ids = selecciones.length
    ? Array.from(new Set(selecciones.map((s) => s.producto_id)))
    : idsLegacy;

  if (ids.length === 0) {
    return NextResponse.json({ productos: [] });
  }
  if (ids.length > MAX_IDS || selecciones.length > MAX_IDS) {
    return NextResponse.json(
      { error: `Máximo ${MAX_IDS} productos por solicitud` },
      { status: 400 },
    );
  }

  const { data: modCfg } = await supabase
    .from('modulo_config')
    .select('facturador_pos')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (!modCfg?.facturador_pos) {
    return NextResponse.json(
      { error: "El módulo 'facturador_pos' no está habilitado para tu plan." },
      { status: 403 },
    );
  }

  const rawSucursal =
    typeof b.sucursal_id === 'string' ? String(b.sucursal_id).trim() : '';
  const sucursalScope = await resolveAndValidateSucursalScope(
    session,
    rawSucursal || null,
  );
  if (!sucursalScope.ok) return sucursalScope.response;
  if (!sucursalScope.sucursalId) {
    return NextResponse.json(
      { error: 'No hay sucursal operativa seleccionada.' },
      { status: 400 },
    );
  }
  const sucursalId = sucursalScope.sucursalId;

  const { data, error } = await supabase
    .from('producto')
    .select(SELECT_COLS)
    .eq('tenant_id', tenantId)
    .in('id', ids);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as ProductoRow[];
  const enriquecidos = await enriquecerProductosPosConSucursalCaja(
    supabase,
    tenantId,
    sucursalId,
    rows,
  );
  let productos = await enrichProductosPayloadConTramos({
    supabase,
    tenantId,
    productos: enriquecidos,
  });

  if (selecciones.length > 0) {
    const varianteIds = [
      ...new Set(
        selecciones
          .map((s) => s.producto_variante_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const variantesMap = new Map<
      string,
      {
        id: string;
        producto_id: string;
        codigo: string | null;
        codigo_barras: string | null;
        atributos: Record<string, unknown> | null;
        etiqueta: string | null;
      }
    >();

    if (varianteIds.length > 0) {
      const { data: variantes } = await supabase
        .from('producto_variante')
        .select('id, producto_id, codigo, codigo_barras, atributos, etiqueta')
        .eq('tenant_id', tenantId)
        .eq('activo', true)
        .in('id', varianteIds);

      for (const v of variantes ?? []) {
        variantesMap.set(v.id, {
          id: v.id,
          producto_id: v.producto_id,
          codigo: v.codigo,
          codigo_barras: v.codigo_barras,
          atributos: (v.atributos ?? null) as Record<string, unknown> | null,
          etiqueta: v.etiqueta,
        });
      }
    }

    const stockVarianteMap = await fetchStockVariantePorIds(supabase, {
      tenantId,
      sucursalId,
      varianteIds,
    });
    const porProducto = new Map(productos.map((p) => [p.id, p] as const));
    productos = selecciones
      .map((sel) => {
        const producto = porProducto.get(sel.producto_id);
        if (!producto) return null;
        if (!sel.producto_variante_id) return producto;

        const variante = variantesMap.get(sel.producto_variante_id);
        if (!variante || variante.producto_id !== sel.producto_id) return null;
        const stock = stockVarianteMap.get(variante.id);
        const etiqueta = etiquetaVariante(variante.atributos, variante.etiqueta);

        return {
          ...producto,
          codigo: variante.codigo || producto.codigo,
          codigo_barras: variante.codigo_barras ?? producto.codigo_barras ?? null,
          nombre: etiquetaProductoConVariante(producto.nombre, {
            atributos: variante.atributos,
            etiqueta,
          }),
          stock_actual: stock?.stock_actual ?? 0,
          stock_minimo: stock?.stock_minimo ?? producto.stock_minimo,
          producto_variante_id: variante.id,
          variante: {
            id: variante.id,
            codigo: variante.codigo,
            codigo_barras: variante.codigo_barras,
            atributos: variante.atributos,
            etiqueta,
          },
        };
      })
      .filter((p): p is NonNullable<typeof p> => Boolean(p));
  }

  return NextResponse.json({ productos });
}
