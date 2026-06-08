import { NextResponse } from 'next/server';

import { getTenantSession } from '@/lib/api/tenant-session';
import { idsSucursalesOperables } from '@/lib/api/sucursal-scope';
import { expandirCategoriaIdsPorNombre } from '@/lib/categorias/tenant-scope';
import {
  dedupeProductosPorId,
  descuentosPromoPorProductoIds,
  filasQendraBalanzaACsv,
  productoAFilaQendraBalanza,
} from '@/lib/productos/export-qendra-balanza';
import { moduloGuard } from '@/lib/modulos/guard';

const CHUNK = 500;
const MAX_FILAS = 5000;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Pesables con PLU, o no pesables en unidad con PLU (venta por unidad en balanza). */
const FILTRO_QENDRA_EXPORT =
  'es_pesable.eq.true,and(es_pesable.eq.false,unidad.eq.unidad)';

const selectQendra =
  'id, codigo, nombre, precio_venta, plu, es_pesable, unidad, fecha_vencimiento, descripcion, categoria:categoria_id(id, nombre)';

type ProductoQendraRow = {
  id: string;
  codigo: string;
  nombre: string;
  precio_venta: number;
  plu: string | null;
  es_pesable: boolean;
  unidad: string;
  fecha_vencimiento: string | null;
  descripcion: string | null;
  categoria: { id: string; nombre: string } | null;
};

export type ExportQendraBalanzaBody = {
  categoria_ids?: string[];
  producto_ids?: string[];
  /** Si se indica, todas las filas usan este sector; si no, la categoría de cada producto. */
  sector_fijo?: string;
};

function parseUuidList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) {
    const id = String(x ?? '').trim();
    if (UUID_RE.test(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

function parseIdsFromSearchParams(params: URLSearchParams, key: string): string[] {
  return params
    .getAll(key)
    .map((s) => s.trim())
    .filter((id) => UUID_RE.test(id));
}

const QENDRA_EXPORT_FILENAME = 'qendra.csv';

function sectorDeProducto(
  p: ProductoQendraRow,
  sectorFijo: string | null,
  categoriasPorId: Map<string, string>,
): string {
  if (sectorFijo) return sectorFijo;
  if (p.categoria?.nombre) return p.categoria.nombre;
  if (p.categoria?.id && categoriasPorId.has(p.categoria.id)) {
    return categoriasPorId.get(p.categoria.id)!;
  }
  return 'GENERAL';
}

async function exportarQendraBalanza(opts: {
  supabase: Awaited<ReturnType<typeof import('@/lib/supabase/server').createServerClient>>;
  tenantId: string;
  sucursalIds: string[];
  categoriaIds: string[];
  productoIds: string[];
  sectorFijo: string | null;
}): Promise<Response> {
  const { supabase, tenantId, sucursalIds, categoriaIds, productoIds, sectorFijo } = opts;

  if (categoriaIds.length === 0 && productoIds.length === 0) {
    return NextResponse.json(
      { error: 'Elegí al menos una categoría o uno o más productos para exportar.' },
      { status: 400 },
    );
  }

  const categoriasPorId = new Map<string, string>();
  if (categoriaIds.length > 0) {
    const { data: cats, error: catsErr } = await supabase
      .from('categoria')
      .select('id, nombre, activa')
      .eq('tenant_id', tenantId)
      .in('id', categoriaIds);
    if (catsErr) {
      console.error('[export-qendra-balanza] categorias', catsErr.message);
      return NextResponse.json({ error: 'No se pudieron validar las categorías.' }, { status: 500 });
    }
    const activas = (cats ?? []).filter((c) => c.activa);
    if (activas.length !== categoriaIds.length) {
      return NextResponse.json(
        { error: 'Una o más categorías no existen o están inactivas.' },
        { status: 404 },
      );
    }
    for (const c of activas) {
      categoriasPorId.set(c.id, c.nombre);
    }
  }

  let acum: ProductoQendraRow[] = [];

  if (productoIds.length > 0) {
    if (productoIds.length > MAX_FILAS) {
      return NextResponse.json(
        { error: `Demasiados productos (${productoIds.length}). Máximo ${MAX_FILAS}.` },
        { status: 400 },
      );
    }
    for (let i = 0; i < productoIds.length; i += CHUNK) {
      const lote = productoIds.slice(i, i + CHUNK);
      const { data, error } = await supabase
        .from('producto')
        .select(selectQendra)
        .eq('tenant_id', tenantId)
        .eq('activo', true)
        .not('plu', 'is', null)
        .or(FILTRO_QENDRA_EXPORT)
        .in('sucursal_id', sucursalIds)
        .in('id', lote)
        .order('nombre');
      if (error) {
        console.error('[export-qendra-balanza] producto_ids', error.message);
        return NextResponse.json({ error: 'No se pudo listar productos.' }, { status: 500 });
      }
      acum.push(...((data ?? []) as ProductoQendraRow[]));
    }
  }

  if (categoriaIds.length > 0) {
    let countQ = supabase
      .from('producto')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('activo', true)
      .not('plu', 'is', null)
      .or(FILTRO_QENDRA_EXPORT)
      .in('sucursal_id', sucursalIds)
      .in('categoria_id', categoriaIds);

    const { count, error: countErr } = await countQ;
    if (countErr) {
      console.error('[export-qendra-balanza] count', countErr.message);
      return NextResponse.json({ error: 'No se pudo contar productos.' }, { status: 500 });
    }

    const total = count ?? 0;
    if (acum.length + total > MAX_FILAS) {
      return NextResponse.json(
        {
          error: `Hay demasiados productos (${acum.length + total}). El máximo por exportación es ${MAX_FILAS}.`,
        },
        { status: 400 },
      );
    }

    for (let from = 0; from < total; from += CHUNK) {
      const to = Math.min(from + CHUNK - 1, Math.max(0, total - 1));
      const { data, error } = await supabase
        .from('producto')
        .select(selectQendra)
        .eq('tenant_id', tenantId)
        .eq('activo', true)
        .not('plu', 'is', null)
        .or(FILTRO_QENDRA_EXPORT)
        .in('sucursal_id', sucursalIds)
        .in('categoria_id', categoriaIds)
        .order('nombre')
        .range(from, to);
      if (error) {
        console.error('[export-qendra-balanza] categorias list', error.message);
        return NextResponse.json({ error: 'No se pudo listar productos.' }, { status: 500 });
      }
      acum.push(...((data ?? []) as ProductoQendraRow[]));
    }
  }

  acum = dedupeProductosPorId(acum);
  acum.sort((a, b) =>
    a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }),
  );

  if (acum.length === 0) {
    return NextResponse.json(
      {
        error:
          'No hay productos exportables con PLU (pesables o por unidad con PLU). Revisá que estén activos y tengan PLU.',
      },
      { status: 404 },
    );
  }

  const descuentosPromo = await descuentosPromoPorProductoIds(
    supabase,
    acum.map((p) => p.id),
  );

  const filasCsv = acum.map((p) =>
    productoAFilaQendraBalanza({
      plu: p.plu,
      nombre: p.nombre,
      precio_venta: p.precio_venta,
      sector: sectorDeProducto(p, sectorFijo, categoriasPorId),
      es_pesable: p.es_pesable === true,
      unidad: p.unidad,
      fecha_vencimiento: p.fecha_vencimiento,
      ingredientes: p.descripcion,
      descuento_pct: descuentosPromo.get(p.id) ?? null,
    }),
  );

  return new Response(filasQendraBalanzaACsv(filasCsv), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${QENDRA_EXPORT_FILENAME}"`,
    },
  });
}

async function resolverSucursalesYExport(
  session: Awaited<ReturnType<typeof getTenantSession>>,
  input: ExportQendraBalanzaBody,
): Promise<Response> {
  if ('error' in session) return session.error;

  const { supabase, tenantId } = session;
  let categoriaIds = parseUuidList(input.categoria_ids);
  const productoIds = parseUuidList(input.producto_ids);
  const sectorFijo = (input.sector_fijo ?? '').trim() || null;

  if (categoriaIds.length > 0) {
    try {
      categoriaIds = await expandirCategoriaIdsPorNombre(supabase, tenantId, categoriaIds);
    } catch {
      // Si falla la expansión, se usan los IDs originales.
    }
  }

  const op = await idsSucursalesOperables(session);
  if (!op.ok) return op.response;
  if (op.ids.length === 0) {
    return NextResponse.json(
      { error: 'No tenés sucursales asignadas para exportar el catálogo.' },
      { status: 403 },
    );
  }

  return exportarQendraBalanza({
    supabase,
    tenantId,
    sucursalIds: op.ids,
    categoriaIds,
    productoIds,
    sectorFijo,
  });
}

/**
 * CSV de productos con PLU para Qendra (Systel Max): sin encabezados; tipo `p`/`u`.
 * GET: `categoria_ids` y/o `producto_ids` (repetibles). Opcional `sector_fijo`.
 * POST: JSON `{ categoria_ids?, producto_ids?, sector_fijo? }`.
 */
export async function GET(request: Request) {
  const guard = await moduloGuard('facturador_pos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  const params = new URL(request.url).searchParams;
  const categoriaIds = parseIdsFromSearchParams(params, 'categoria_ids');
  const productoIds = parseIdsFromSearchParams(params, 'producto_ids');
  const legacyCat = (params.get('categoria_id') ?? '').trim();
  if (legacyCat && UUID_RE.test(legacyCat) && !categoriaIds.includes(legacyCat)) {
    categoriaIds.push(legacyCat);
  }
  const sectorFijo =
    (params.get('sector_fijo') ?? params.get('seccion') ?? '').trim() || undefined;

  return resolverSucursalesYExport(session, {
    categoria_ids: categoriaIds,
    producto_ids: productoIds,
    sector_fijo: sectorFijo,
  });
}

export async function POST(request: Request) {
  const guard = await moduloGuard('facturador_pos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  let body: ExportQendraBalanzaBody = {};
  try {
    body = (await request.json()) as ExportQendraBalanzaBody;
  } catch {
    return NextResponse.json({ error: 'Cuerpo JSON inválido.' }, { status: 400 });
  }

  return resolverSucursalesYExport(session, body);
}
