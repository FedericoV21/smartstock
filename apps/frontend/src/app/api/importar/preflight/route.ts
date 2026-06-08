import { NextResponse } from 'next/server';

import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { loadEffectiveBusinessPrefs } from '@/lib/business-prefs/server';
import { apiErrorPayload } from '@/lib/errors/user-copy';
import { claveProductoMatchCodigoUnidad } from '@/lib/importar/clave-producto-import';
import {
  importServerError,
  importServerLog,
  importServerWarn,
} from '@/lib/importar/import-server-log';
import { resolverUnidadStockImportacion } from '@/lib/producto/inferir-unidad-stock-desde-texto';
import { moduloGuard } from '@/lib/modulos/guard';
import {
  esMatchEstrictoCodigoBarcode,
  normalizarBarcodeMatch,
} from '@/lib/productos/upsert-con-proveedor';
import type { Database } from '@/types/database';

type UnidadMedida = Database['public']['Enums']['unidad_medida'];

type PreflightFila = {
  fila_original: number;
  codigo: string | null;
  nombre: string;
  unidad?: string | null;
  codigo_barras?: string | null;
};

type PreflightRequest = {
  filas: PreflightFila[];
  proveedor_id: string | null;
  sucursal_id?: string | null;
  forzar_productos_pesables?: boolean;
  aplicar_inferencia_pesable_por_nombre?: boolean;
};

type ProductoMini = {
  id: string;
  codigo: string;
  nombre: string;
  unidad: UnidadMedida;
  codigo_barras: string | null;
  proveedor_id: string | null;
  sucursal_id: string;
  sucursal_nombre?: string | null;
  activo: boolean;
  updated_at: string;
  stock_actual: number;
  precio_costo: number;
  precio_venta: number;
  unidad_compra: UnidadMedida | null;
  contenido_unidad_compra: number | null;
};

const LOG = '[importar/preflight]';

const PROVEEDOR_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Max codigos por `.in()` para evitar URL/query enormes en listas de miles de SKUs. */
const CODIGOS_PREFLIGHT_CHUNK = 400;

function chunkStrings(items: string[], size: number): string[][] {
  if (items.length <= size) return items.length === 0 ? [] : [items];
  const out: string[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export async function POST(request: Request) {
  try {
    return await postPreflight(request);
  } catch (e) {
    importServerError(LOG, { msg: 'excepcion no capturada', error: e });
    return NextResponse.json(
      apiErrorPayload(
        'importador',
        e instanceof Error ? e.message : 'Error inesperado',
        'No pudimos completar el preanálisis de la importación. Reintentá en unos minutos.',
      ),
      { status: 500 },
    );
  }
}

async function postPreflight(request: Request) {
  const guard = await moduloGuard('importador_excel');
  if (!guard.allowed) {
    importServerLog(LOG, { msg: 'modulo guard: sin acceso importador_excel' });
    return guard.response;
  }

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  let body: PreflightRequest;
  try {
    body = (await request.json()) as PreflightRequest;
  } catch {
    importServerWarn(LOG, { msg: 'JSON body invalido' });
    return NextResponse.json(
      apiErrorPayload('importador', 'json invalido', 'No pudimos interpretar la solicitud de importación.'),
      { status: 400 },
    );
  }

  const filas = Array.isArray(body.filas) ? body.filas : [];
  const proveedorIdRaw =
    typeof body.proveedor_id === 'string' && body.proveedor_id.trim()
      ? body.proveedor_id.trim()
      : null;
  if (proveedorIdRaw && !PROVEEDOR_UUID_RE.test(proveedorIdRaw)) {
    importServerWarn(LOG, { msg: 'reject: proveedor_id invalido' });
    return NextResponse.json(
      apiErrorPayload('importador', 'proveedor invalido', 'El proveedor seleccionado no es válido. Volvé a elegirlo.'),
      { status: 400 },
    );
  }
  const proveedorId = proveedorIdRaw;
  const forzarProductosPesables = body.forzar_productos_pesables === true;
  const optsUnidadImportacion = {
    forzarProductosPesables,
    aplicarInferenciaPesablePorNombre:
      body.aplicar_inferencia_pesable_por_nombre === true && !forzarProductosPesables,
  };

  const sucursalScope = await resolveAndValidateSucursalScope(session, body.sucursal_id ?? null);
  if (!sucursalScope.ok) return sucursalScope.response;
  if (!sucursalScope.sucursalId) {
    importServerWarn(LOG, { msg: 'reject: sin sucursal operativa' });
    return NextResponse.json({ error: 'No hay sucursal operativa seleccionada.' }, { status: 400 });
  }

  if (filas.length === 0) {
    importServerWarn(LOG, { msg: 'reject: sin filas' });
    return NextResponse.json({ error: 'No hay filas para analizar' }, { status: 400 });
  }

  const codigos = Array.from(
    new Set(
      filas
        .map((f) => (typeof f.codigo === 'string' ? f.codigo.trim() : null))
        .filter((c): c is string => Boolean(c)),
    ),
  );

  if (codigos.length === 0) {
    importServerLog(LOG, { msg: 'salida anticipada: sin codigos en filas' });
    return NextResponse.json({ matches: {} as Record<string, ProductoMini[]> });
  }

  // Cuando `unificarProductosEntreProveedores` esta activa: candidatos tenant-wide; match codigo + barcode estricto.
  const businessPrefs = await loadEffectiveBusinessPrefs(
    session.supabase,
    session.tenantId,
    sucursalScope.sucursalId,
  );
  const unificar = businessPrefs.unificarProductosEntreProveedores === true;

  const codigoChunks = chunkStrings(codigos, CODIGOS_PREFLIGHT_CHUNK);

  importServerLog(LOG, {
    evento: 'consultando',
    filas: filas.length,
    codigos: codigos.length,
  });

  const productos: ProductoMini[] = [];
  for (let ci = 0; ci < codigoChunks.length; ci++) {
    const slice = codigoChunks[ci]!;
    let qb = session.supabase
      .from('producto')
      .select(
        'id, codigo, nombre, unidad, unidad_compra, contenido_unidad_compra, codigo_barras, proveedor_id, sucursal_id, activo, updated_at, stock_actual, precio_costo, precio_venta',
      )
      .eq('tenant_id', session.tenantId)
      .in('codigo', slice);

    if (!unificar) {
      qb = proveedorId ? qb.eq('proveedor_id', proveedorId) : qb.is('proveedor_id', null);
    }

    const { data: parte, error } = await qb;
    if (error) {
      importServerError(LOG, {
        msg: 'error query producto lote',
        lote: `${ci + 1}/${codigoChunks.length}`,
        code: error.code,
        message: error.message,
      });
      return NextResponse.json(
        apiErrorPayload(
          'importador',
          error.message,
          'No pudimos consultar los productos para el preanálisis. Reintentá en unos minutos.',
        ),
        { status: 500 },
      );
    }
    productos.push(...((parte ?? []) as unknown as ProductoMini[]));
  }

  const { data: sucursales } = await session.supabase
    .from('sucursal')
    .select('id, nombre')
    .eq('tenant_id', session.tenantId);
  const sucursalNombre = new Map((sucursales ?? []).map((s) => [s.id, s.nombre]));

  // Mapas: codigo+unidad (historico) y codigo (match cross-proveedor con pref unificar).
  const porClave = new Map<string, ProductoMini[]>();
  const porCodigo = new Map<string, ProductoMini[]>();
  for (const p of productos) {
    p.sucursal_nombre = sucursalNombre.get(p.sucursal_id) ?? null;

    const codKey = (p.codigo ?? '').trim().toLowerCase();
    if (codKey) {
      const arrCod = porCodigo.get(codKey) ?? [];
      arrCod.push(p);
      porCodigo.set(codKey, arrCod);
    }

    // poblar porClave con candidatos mismo proveedor o sin proveedor (contexto historico).
    const enContexto = !unificar
      ? true
      : proveedorId
        ? p.proveedor_id === proveedorId
        : p.proveedor_id == null;
    if (enContexto) {
      const k = claveProductoMatchCodigoUnidad(p.codigo ?? '', p.unidad);
      const arr = porClave.get(k) ?? [];
      arr.push(p);
      porClave.set(k, arr);
    }
  }

  const requiereResolucion: Record<
    string,
    { motivo: 'unidad_distinta'; unidad_fila: UnidadMedida }
  > = {};
  const out: Record<string, ProductoMini[]> = {};
  for (const f of filas) {
    const codigo = typeof f.codigo === 'string' ? f.codigo.trim() : '';
    const nombre = typeof f.nombre === 'string' ? f.nombre : '';
    if (!codigo) continue;
    const unidadFila = resolverUnidadStockImportacion(
      { nombre, unidad: f.unidad ?? undefined },
      'unidad',
      optsUnidadImportacion,
    );
    const k = claveProductoMatchCodigoUnidad(codigo, unidadFila);
    let candidatos = porClave.get(k) ?? [];
    const key = String(f.fila_original);

    if (unificar) {
      candidatos = candidatos.filter((p) => p.activo);
    }

    // Con pref unifica: sin match historico, probar codigo+barcode estricto contra tenant.
    if (
      candidatos.length === 0 &&
      unificar &&
      normalizarBarcodeMatch(f.codigo_barras ?? null) != null
    ) {
      const codKey = codigo.trim().toLowerCase();
      const cross = (porCodigo.get(codKey) ?? []).filter(
        (p) =>
          p.activo &&
          esMatchEstrictoCodigoBarcode(
            { codigo, codigo_barras: f.codigo_barras ?? null },
            { codigo: p.codigo, codigo_barras: p.codigo_barras },
          ),
      );
      if (cross.length > 0) {
        candidatos = cross;
      }
    }

    if (candidatos.length === 0) {
      const codKey = codigo.trim().toLowerCase();
      const mismoCodigo = (porCodigo.get(codKey) ?? [])
        .filter((p) => p.activo && p.unidad !== unidadFila)
        .sort((a, b) => (a.updated_at >= b.updated_at ? -1 : 1));
      if (mismoCodigo.length > 0) {
        candidatos = mismoCodigo;
        requiereResolucion[key] = { motivo: 'unidad_distinta', unidad_fila: unidadFila };
      }
    }
    if (candidatos.length > 0 && candidatos.every((p) => p.unidad !== unidadFila)) {
      requiereResolucion[key] = { motivo: 'unidad_distinta', unidad_fila: unidadFila };
    }

    out[key] = candidatos;
  }

  let filasAmbiguas = 0;
  for (const v of Object.values(out)) {
    if (Array.isArray(v) && v.length >= 2) filasAmbiguas++;
  }
  importServerLog(LOG, {
    evento: 'ok',
    matches: Object.keys(out).length,
    ambiguas: filasAmbiguas,
  });

  return NextResponse.json({ matches: out, requiere_resolucion: requiereResolucion });
}
