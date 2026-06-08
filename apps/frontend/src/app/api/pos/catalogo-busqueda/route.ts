import { NextResponse, type NextRequest } from 'next/server';

import { idsSucursalesOperables, resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession } from '@/lib/api/tenant-session';
import type { PosCatalogoBusquedaItem } from '@/lib/pos/catalogo-busqueda-local';
import {
  dedupeProductosCatalogoParaCaja,
  enriquecerProductosPosConSucursalCaja,
} from '@/lib/pos/enriquecer-productos-pos-sucursal-caja';
import { fetchStockVendiblePorProductoIds, type ProductoRow } from '@/lib/pos/resolver-producto-barcode-pos';

const DEFAULT_LIMIT = 750;
const MAX_LIMIT = 1000;

const PRODUCT_SELECT_COLS =
  'id, codigo, nombre, precio_costo, precio_venta, porcentaje_ganancia, stock_actual, stock_minimo, unidad, unidad_compra, contenido_unidad_compra, es_pesable, codigo_barras, plu, usa_variantes, iva_porcentaje, imagen_url, sucursal_id, rubro, subrubro, texto_buscable, categoria:categoria_id(id, nombre), proveedor:proveedor_id(id, nombre)';

type CatalogoRpcRow = {
  producto_id: string;
  producto_variante_id: string | null;
  codigo: string | null;
  codigo_barras: string | null;
  plu: string | null;
  nombre: string;
  texto_buscable: string | null;
  precio_venta: number | string | null;
  stock_actual: number | string | null;
  stock_minimo: number | string | null;
  unidad: string | null;
  unidad_compra: string | null;
  contenido_unidad_compra: number | string | null;
  es_pesable: boolean | null;
  usa_variantes: boolean | null;
  imagen_url: string | null;
  sucursal_id: string | null;
  proveedor_id: string | null;
  proveedor_nombre: string | null;
  categoria_id: string | null;
  categoria_nombre: string | null;
  rubro: string | null;
  subrubro: string | null;
  variante_codigo: string | null;
  variante_codigo_barras: string | null;
  variante_atributos: Record<string, unknown> | null;
  variante_etiqueta: string | null;
};

function parseIntParam(raw: string | null, fallback: number): number {
  const n = Number.parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function mapRow(row: CatalogoRpcRow): PosCatalogoBusquedaItem {
  const variante =
    row.producto_variante_id != null
      ? {
          id: row.producto_variante_id,
          codigo: row.variante_codigo,
          codigo_barras: row.variante_codigo_barras,
          atributos: row.variante_atributos ?? null,
          etiqueta: row.variante_etiqueta,
        }
      : null;

  return {
    id: row.producto_id,
    producto_id: row.producto_id,
    producto_variante_id: row.producto_variante_id,
    codigo: row.codigo ?? '',
    codigo_barras: row.codigo_barras,
    plu: row.plu,
    nombre: row.nombre,
    texto_buscable: row.texto_buscable,
    precio_venta: asNumber(row.precio_venta),
    stock_actual: asNumber(row.stock_actual),
    stock_minimo: asNumber(row.stock_minimo),
    unidad: row.unidad,
    unidad_compra: row.unidad_compra,
    contenido_unidad_compra:
      row.contenido_unidad_compra != null ? asNumber(row.contenido_unidad_compra) : null,
    es_pesable: row.es_pesable === true,
    usa_variantes: row.usa_variantes === true,
    imagen_url: row.imagen_url,
    sucursal_id: row.sucursal_id,
    proveedor:
      row.proveedor_id && row.proveedor_nombre
        ? { id: row.proveedor_id, nombre: row.proveedor_nombre }
        : null,
    categoria:
      row.categoria_id && row.categoria_nombre
        ? { id: row.categoria_id, nombre: row.categoria_nombre }
        : null,
    rubro: row.rubro,
    subrubro: row.subrubro,
    variante,
  };
}

function relationOne(raw: unknown): { id: string; nombre: string } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  return typeof row.id === 'string' && typeof row.nombre === 'string'
    ? { id: row.id, nombre: row.nombre }
    : null;
}

function mapProductoFallback(row: ProductoRow): PosCatalogoBusquedaItem {
  const r = row as ProductoRow & {
    texto_buscable?: string | null;
    plu?: string | null;
    proveedor?: unknown;
    categoria?: unknown;
  };
  return {
    id: r.id,
    producto_id: r.id,
    producto_variante_id: null,
    codigo: r.codigo ?? '',
    codigo_barras: r.codigo_barras ?? null,
    plu: r.plu ?? null,
    nombre: r.nombre,
    texto_buscable: r.texto_buscable ?? null,
    precio_venta: asNumber(r.precio_venta),
    stock_actual: asNumber(r.stock_actual),
    stock_minimo: asNumber(r.stock_minimo),
    unidad: r.unidad,
    unidad_compra: r.unidad_compra ?? null,
    contenido_unidad_compra: r.contenido_unidad_compra ?? null,
    es_pesable: r.es_pesable === true,
    usa_variantes: r.usa_variantes === true,
    imagen_url: r.imagen_url ?? null,
    sucursal_id: r.sucursal_id,
    proveedor: relationOne(r.proveedor),
    categoria: relationOne(r.categoria),
    rubro: r.rubro ?? null,
    subrubro: r.subrubro ?? null,
    variante: null,
  };
}

function etiquetaVarianteSnapshot(v: {
  etiqueta?: string | null;
  atributos?: Record<string, unknown> | null;
}): string {
  const etiqueta = typeof v.etiqueta === 'string' ? v.etiqueta.trim() : '';
  if (etiqueta) return etiqueta;
  const attrs = v.atributos ?? {};
  return ['talle', 'color', 'material', 'medida']
    .map((key) => {
      const value = attrs[key];
      return value == null ? '' : String(value).trim();
    })
    .filter(Boolean)
    .join(' / ') || 'Variante';
}

async function cargarCatalogoFallback(opts: {
  supabase: {
    from: (table: string) => {
      select: (cols: string) => unknown;
    };
  };
  tenantId: string;
  sucursalId: string;
  limit: number;
  offset: number;
}): Promise<{ productos: PosCatalogoBusquedaItem[]; hasMore: boolean; nextOffset: number | null }> {
  const query = opts.supabase
    .from('producto')
    .select(PRODUCT_SELECT_COLS) as {
    eq: (col: string, value: unknown) => typeof query;
    order: (col: string, opts?: Record<string, unknown>) => typeof query;
    range: (from: number, to: number) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
  };

  const { data, error } = await query
    .eq('tenant_id', opts.tenantId)
    .eq('activo', true)
    .order('nombre')
    .range(opts.offset, opts.offset + opts.limit);

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as ProductoRow[];
  const hasMore = rows.length > opts.limit;
  const pageRows = rows.slice(0, opts.limit);
  const nextOffset = hasMore ? opts.offset + pageRows.length : null;
  if (pageRows.length === 0) return { productos: [], hasMore, nextOffset };

  const stockMap = await fetchStockVendiblePorProductoIds(opts.supabase as never, {
    tenantId: opts.tenantId,
    sucursalId: opts.sucursalId,
    productos: pageRows,
  });
  const deduped = dedupeProductosCatalogoParaCaja(pageRows, opts.sucursalId, stockMap);
  const productosBase = await enriquecerProductosPosConSucursalCaja(
    opts.supabase as never,
    opts.tenantId,
    opts.sucursalId,
    deduped,
    stockMap,
  );
  const items = productosBase.map(mapProductoFallback);
  const idsConVariantes = productosBase.filter((p) => p.usa_variantes).map((p) => p.id);
  if (idsConVariantes.length === 0) return { productos: items, hasMore, nextOffset };

  const { data: variantes } = await (
    opts.supabase
      .from('producto_variante')
      .select('id, producto_id, codigo, codigo_barras, atributos, etiqueta, activo, orden') as {
      eq: (col: string, value: unknown) => {
        eq: (col: string, value: unknown) => {
          in: (
            col: string,
            values: string[],
          ) => {
            order: (col: string) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
          };
        };
      };
    }
  )
    .eq('tenant_id', opts.tenantId)
    .eq('activo', true)
    .in('producto_id', idsConVariantes)
    .order('orden');

  const varianteRows = (variantes ?? []) as Array<{
    id: string;
    producto_id: string;
    codigo: string | null;
    codigo_barras: string | null;
    atributos: Record<string, unknown> | null;
    etiqueta: string | null;
  }>;
  const varianteIds = varianteRows.map((v) => v.id);
  const { data: stocks } = varianteIds.length
    ? await (
        opts.supabase
          .from('producto_variante_stock_sucursal')
          .select('variante_id, stock_actual, stock_minimo, ubicacion') as {
          eq: (col: string, value: unknown) => {
            eq: (col: string, value: unknown) => {
              in: (
                col: string,
                values: string[],
              ) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
            };
          };
        }
      )
        .eq('tenant_id', opts.tenantId)
        .eq('sucursal_id', opts.sucursalId)
        .in('variante_id', varianteIds)
    : { data: [] };

  const stockPorVariante = new Map(
    ((stocks ?? []) as Array<{ variante_id: string; stock_actual: number; stock_minimo: number }>).map(
      (s) => [s.variante_id, s] as const,
    ),
  );
  const basePorId = new Map(items.map((item) => [item.producto_id, item] as const));
  const expanded: PosCatalogoBusquedaItem[] = items.filter((item) => item.usa_variantes !== true);

  for (const variante of varianteRows) {
    const base = basePorId.get(variante.producto_id);
    if (!base) continue;
    const etiqueta = etiquetaVarianteSnapshot(variante);
    const stock = stockPorVariante.get(variante.id);
    expanded.push({
      ...base,
      producto_variante_id: variante.id,
      codigo: variante.codigo || base.codigo,
      codigo_barras: variante.codigo_barras ?? base.codigo_barras ?? null,
      nombre: `${base.nombre} - ${etiqueta}`,
      texto_buscable: [
        base.texto_buscable,
        variante.codigo,
        variante.codigo_barras,
        etiqueta,
        variante.atributos ? JSON.stringify(variante.atributos) : '',
      ]
        .filter(Boolean)
        .join(' '),
      stock_actual: asNumber(stock?.stock_actual),
      stock_minimo: asNumber(stock?.stock_minimo, base.stock_minimo ?? 0),
      variante: {
        id: variante.id,
        codigo: variante.codigo,
        codigo_barras: variante.codigo_barras,
        atributos: variante.atributos,
        etiqueta,
      },
    });
  }

  return { productos: expanded, hasMore, nextOffset };
}

export async function GET(request: NextRequest) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const { supabase, tenantId } = session;
  const { searchParams } = new URL(request.url);

  const sucursalScope = await resolveAndValidateSucursalScope(
    session,
    searchParams.get('sucursal_id'),
  );
  if (!sucursalScope.ok) return sucursalScope.response;
  if (!sucursalScope.sucursalId) {
    return NextResponse.json(
      { error: 'No hay sucursal operativa seleccionada.' },
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
      { error: "El modulo 'facturador_pos' no esta habilitado para tu plan." },
      { status: 403 },
    );
  }

  const operable = await idsSucursalesOperables(session);
  if (!operable.ok) return operable.response;
  if (operable.ids.length === 0) {
    return NextResponse.json(
      { error: 'No tenes sucursales asignadas para operar el POS.' },
      { status: 403 },
    );
  }

  const offset = Math.max(0, parseIntParam(searchParams.get('offset'), 0));
  const limit = Math.max(
    1,
    Math.min(parseIntParam(searchParams.get('limit'), DEFAULT_LIMIT), MAX_LIMIT),
  );

  const { data, error } = await (supabase as unknown as {
    rpc: (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  }).rpc('pos_catalogo_busqueda_snapshot', {
    p_tenant_id: tenantId,
    p_sucursal_id: sucursalScope.sucursalId,
    p_limit: limit + 1,
    p_offset: offset,
  });

  let productos: PosCatalogoBusquedaItem[];
  let hasMore: boolean;
  let nextOffset: number | null;
  if (error) {
    try {
      const fallback = await cargarCatalogoFallback({
        supabase,
        tenantId,
        sucursalId: sucursalScope.sucursalId,
        limit,
        offset,
      });
      productos = fallback.productos;
      hasMore = fallback.hasMore;
      nextOffset = fallback.nextOffset;
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : error.message },
        { status: 500 },
      );
    }
  } else {
    const rows = (Array.isArray(data) ? data : []) as CatalogoRpcRow[];
    hasMore = rows.length > limit;
    productos = rows.slice(0, limit).map(mapRow);
    nextOffset = hasMore ? offset + productos.length : null;
  }

  return NextResponse.json(
    {
      productos,
      limit,
      offset,
      next_offset: nextOffset,
      has_more: hasMore,
      snapshot_at: new Date().toISOString(),
      cache_ttl_ms: 10 * 60 * 1000,
    },
    {
      headers: {
        'Cache-Control': 'private, max-age=60, stale-while-revalidate=300',
      },
    },
  );
}
