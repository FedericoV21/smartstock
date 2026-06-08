import { NextResponse } from 'next/server';

import { idsSucursalesOperables } from '@/lib/api/sucursal-scope';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { loadEffectiveBusinessPrefs } from '@/lib/business-prefs/server';
import { moduloGuard } from '@/lib/modulos/guard';
import {
  atributosVarianteToJson,
  etiquetaVariante,
  normalizarAtributosVariante,
} from '@/lib/productos/variantes';
import type { Json } from '@/types/database';

type StockInput = {
  sucursal_id: string;
  stock_actual?: number;
  stock_minimo?: number;
  ubicacion?: string | null;
};

function parseStockInputs(raw: unknown): StockInput[] {
  if (!Array.isArray(raw)) return [];
  const out: StockInput[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const r = row as Record<string, unknown>;
    const sucursalId = typeof r.sucursal_id === 'string' ? r.sucursal_id.trim() : '';
    if (!sucursalId) continue;
    const stockActual = r.stock_actual == null || r.stock_actual === '' ? undefined : Number(r.stock_actual);
    const stockMinimo = r.stock_minimo == null || r.stock_minimo === '' ? undefined : Number(r.stock_minimo);
    out.push({
      sucursal_id: sucursalId,
      ...(stockActual != null && Number.isFinite(stockActual) ? { stock_actual: stockActual } : {}),
      ...(stockMinimo != null && Number.isFinite(stockMinimo) ? { stock_minimo: stockMinimo } : {}),
      ubicacion: typeof r.ubicacion === 'string' && r.ubicacion.trim() ? r.ubicacion.trim() : null,
    });
  }
  return out;
}

async function assertProductoOperable(session: Awaited<ReturnType<typeof getTenantSession>>, productoId: string) {
  if ('error' in session) return { ok: false as const, response: session.error };
  const operable = await idsSucursalesOperables(session);
  if (!operable.ok) return { ok: false as const, response: operable.response };

  const { data: producto, error } = await session.supabase
    .from('producto')
    .select('id, sucursal_id, usa_variantes, nombre, codigo_barras')
    .eq('id', productoId)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();

  if (error) return { ok: false as const, response: NextResponse.json({ error: error.message }, { status: 500 }) };
  if (!producto?.sucursal_id) {
    return { ok: false as const, response: NextResponse.json({ error: 'Producto no encontrado.' }, { status: 404 }) };
  }
  if (!operable.ids.includes(producto.sucursal_id)) {
    return { ok: false as const, response: NextResponse.json({ error: 'No tenés permisos para este producto.' }, { status: 403 }) };
  }
  return { ok: true as const, producto, sucursalIds: operable.ids };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await moduloGuard('stock');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const { id: productoId } = await params;
  const scoped = await assertProductoOperable(session, productoId);
  if (!scoped.ok) return scoped.response;

  const { data: variantes, error } = await session.supabase
    .from('producto_variante')
    .select('id, producto_id, codigo, codigo_barras, atributos, etiqueta, activo, orden, created_at, updated_at')
    .eq('tenant_id', session.tenantId)
    .eq('producto_id', productoId)
    .order('orden')
    .order('created_at');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const varianteIds = ((variantes ?? []) as Array<{ id: string }>).map((v) => v.id);
  const { data: stockRows, error: stockErr } = varianteIds.length
    ? await session.supabase
        .from('producto_variante_stock_sucursal')
        .select('variante_id, sucursal_id, stock_actual, stock_minimo, ubicacion, sucursal:sucursal_id(id, nombre, codigo)')
        .eq('tenant_id', session.tenantId)
        .in('variante_id', varianteIds)
        .in('sucursal_id', scoped.sucursalIds)
    : { data: [], error: null };

  if (stockErr) return NextResponse.json({ error: stockErr.message }, { status: 500 });

  const stockPorVariante = new Map<string, unknown[]>();
  for (const row of (stockRows ?? []) as Array<Record<string, unknown> & { variante_id: string }>) {
    const arr = stockPorVariante.get(row.variante_id) ?? [];
    arr.push({
      sucursal_id: row.sucursal_id,
      stock_actual: Number(row.stock_actual ?? 0),
      stock_minimo: Number(row.stock_minimo ?? 0),
      ubicacion: row.ubicacion ?? null,
      sucursal: row.sucursal ?? null,
    });
    stockPorVariante.set(row.variante_id, arr);
  }

  return NextResponse.json({
    producto_id: productoId,
    usa_variantes: Boolean((scoped.producto as { usa_variantes?: boolean }).usa_variantes),
    variantes: ((variantes ?? []) as Array<Record<string, unknown> & { id: string; atributos: Json; etiqueta: string | null }>).map((v) => ({
      ...v,
      etiqueta: etiquetaVariante(v.atributos, v.etiqueta),
      stock_sucursal: stockPorVariante.get(v.id) ?? [],
    })),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await moduloGuard('stock');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const { id: productoId } = await params;
  const scoped = await assertProductoOperable(session, productoId);
  if (!scoped.ok) return scoped.response;

  const prefs = await loadEffectiveBusinessPrefs(session.supabase, session.tenantId, scoped.producto.sucursal_id);
  if (!prefs.productosVariantesHabilitado) {
    return NextResponse.json({ error: 'Las variantes todavía no están habilitadas para este negocio.' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};

  const atributos = normalizarAtributosVariante(b.atributos);
  const etiqueta = typeof b.etiqueta === 'string' && b.etiqueta.trim() ? b.etiqueta.trim() : null;
  const codigo = typeof b.codigo === 'string' && b.codigo.trim() ? b.codigo.trim() : null;
  const codigoBarras =
    typeof b.codigo_barras === 'string' && b.codigo_barras.trim() ? b.codigo_barras.trim() : null;
  const orden = Number.isFinite(Number(b.orden)) ? Number(b.orden) : 0;

  if (Object.keys(atributos).length === 0 && !codigo && !codigoBarras && !etiqueta) {
    return NextResponse.json(
      { error: 'La variante necesita al menos un atributo, etiqueta, código o código de barras.' },
      { status: 400 },
    );
  }

  if (codigoBarras) {
    const { data: productoConBarra } = await session.supabase
      .from('producto')
      .select('id, nombre')
      .eq('tenant_id', session.tenantId)
      .eq('codigo_barras', codigoBarras)
      .eq('activo', true)
      .limit(1)
      .maybeSingle();
    if (productoConBarra) {
      return NextResponse.json(
        { error: `Ese código de barras ya pertenece al producto "${productoConBarra.nombre}".` },
        { status: 409 },
      );
    }
  }

  const { data: variante, error } = await session.supabase
    .from('producto_variante')
    .insert({
      tenant_id: session.tenantId,
      producto_id: productoId,
      codigo,
      codigo_barras: codigoBarras,
      atributos: atributosVarianteToJson(atributos),
      etiqueta,
      orden,
      activo: b.activo !== false,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Ya existe una variante activa con esos datos.' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const varianteId = (variante as { id: string }).id;
  const stockInputs = parseStockInputs(b.stock_sucursal);
  const bySucursal = new Map(stockInputs.map((s) => [s.sucursal_id, s]));
  const stockRows = scoped.sucursalIds.map((sucursalId) => {
    const s = bySucursal.get(sucursalId);
    return {
      tenant_id: session.tenantId,
      producto_id: productoId,
      variante_id: varianteId,
      sucursal_id: sucursalId,
      stock_actual: s?.stock_actual ?? 0,
      stock_minimo: s?.stock_minimo ?? 0,
      ubicacion: s?.ubicacion ?? null,
    };
  });
  if (stockRows.length > 0) {
    const { error: stockErr } = await session.supabase
      .from('producto_variante_stock_sucursal')
      .insert(stockRows);
    if (stockErr) {
      return NextResponse.json(
        { error: `Variante creada pero no se pudo inicializar stock: ${stockErr.message}` },
        { status: 500 },
      );
    }
  }

  await session.supabase
    .from('producto')
    .update({ usa_variantes: true })
    .eq('id', productoId)
    .eq('tenant_id', session.tenantId);

  return NextResponse.json(
    {
      ...(variante as Record<string, unknown>),
      etiqueta: etiquetaVariante((variante as { atributos?: unknown }).atributos, (variante as { etiqueta?: string | null }).etiqueta),
    },
    { status: 201 },
  );
}
