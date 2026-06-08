import { NextResponse } from 'next/server';

import { idsSucursalesOperables } from '@/lib/api/sucursal-scope';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';
import { debugGananciaTramos } from '@/lib/productos/debug-ganancia-tramos-logs';

type TramoInput = { cantidad_desde: number; ganancia_pct: number };

function toNum(v: unknown): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : NaN;
}

function validarTramos(raw: unknown): { ok: true; tramos: TramoInput[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: 'tramos debe ser un array' };
  const out: TramoInput[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      return { ok: false, error: 'tramo inválido' };
    }
    const obj = r as Record<string, unknown>;
    const cantidad_desde = toNum(obj.cantidad_desde);
    const ganancia_pct = toNum(obj.ganancia_pct);
    if (!(cantidad_desde >= 1)) {
      return { ok: false, error: 'cantidad_desde debe ser >= 1' };
    }
    if (!(ganancia_pct >= 0)) {
      return { ok: false, error: 'ganancia_pct debe ser >= 0' };
    }
    out.push({
      cantidad_desde: Math.round(cantidad_desde * 1000) / 1000,
      ganancia_pct: Math.round(ganancia_pct * 100) / 100,
    });
  }

  // Dedup por cantidad_desde (último gana); conservar orden del array recibido.
  const last = new Map<number, TramoInput>();
  for (const t of out) {
    last.set(t.cantidad_desde, t);
  }
  const seenKeys = new Set<number>();
  const keyOrder: number[] = [];
  for (const t of out) {
    if (seenKeys.has(t.cantidad_desde)) continue;
    seenKeys.add(t.cantidad_desde);
    keyOrder.push(t.cantidad_desde);
  }
  const dedup = keyOrder.map((k) => last.get(k)!);
  return { ok: true, tramos: dedup };
}

async function assertProductoOperable(session: Awaited<ReturnType<typeof getTenantSession>>, productoId: string) {
  if ('error' in session) return session.error;

  const operable = await idsSucursalesOperables(session);
  if (!operable.ok) return operable.response;
  if (operable.ids.length === 0) {
    return NextResponse.json({ error: 'No hay sucursales operativas.' }, { status: 403 });
  }

  const { data: productoScope, error: scopeErr } = await session.supabase
    .from('producto')
    .select('id, sucursal_id')
    .eq('id', productoId)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();

  if (scopeErr) {
    return NextResponse.json({ error: scopeErr.message }, { status: 500 });
  }
  if (!productoScope?.sucursal_id) {
    return NextResponse.json({ error: 'Producto no encontrado' }, { status: 404 });
  }
  if (!operable.ids.includes(productoScope.sucursal_id)) {
    return NextResponse.json({ error: 'No tenés permisos para ver este producto.' }, { status: 403 });
  }
  return null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await moduloGuard('stock');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const { id } = await params;
  const scopeErr = await assertProductoOperable(session, id);
  if (scopeErr) return scopeErr;

  const { data, error } = await session.supabase
    .from('producto_ganancia_tramo')
    .select('id, cantidad_desde, ganancia_pct, orden')
    .eq('tenant_id', session.tenantId)
    .eq('producto_id', id)
    .order('orden', { ascending: true })
    .order('cantidad_desde', { ascending: true });

  if (error) {
    debugGananciaTramos('GET error', { producto_id: id, message: error.message });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const tramos = (data ?? []).map((r) => ({
    id: r.id,
    cantidad_desde: Number(r.cantidad_desde),
    ganancia_pct: Number(r.ganancia_pct),
    orden: typeof r.orden === 'number' ? r.orden : Number(r.orden) || 0,
  }));
  debugGananciaTramos('GET ok', {
    producto_id: id,
    tenant_id: session.tenantId,
    count: tramos.length,
    tramos: tramos.map((t) => ({
      cantidad_desde: t.cantidad_desde,
      ganancia_pct: t.ganancia_pct,
      orden: t.orden,
    })),
  });
  return NextResponse.json({ producto_id: id, tramos });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await moduloGuard('stock');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const { id } = await params;
  const scopeErr = await assertProductoOperable(session, id);
  if (scopeErr) return scopeErr;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const val = validarTramos(b.tramos);
  if (!val.ok) {
    debugGananciaTramos('PUT validación falló', { producto_id: id, error: val.error, raw_tramos: b.tramos });
    return NextResponse.json({ error: val.error }, { status: 400 });
  }

  debugGananciaTramos('PUT recibido (tras validar)', {
    producto_id: id,
    tenant_id: session.tenantId,
    usuario: session.userId,
    count: val.tramos.length,
    tramos: val.tramos.map((t, i) => ({ ...t, orden: i })),
  });

  // Estrategia simple: reemplazar todo.
  const del = await session.supabase
    .from('producto_ganancia_tramo')
    .delete()
    .eq('tenant_id', session.tenantId)
    .eq('producto_id', id);
  if (del.error) {
    debugGananciaTramos('PUT delete previo falló', { producto_id: id, message: del.error.message });
    return NextResponse.json({ error: del.error.message }, { status: 500 });
  }

  if (val.tramos.length === 0) {
    debugGananciaTramos('PUT lista vacía (solo borró)', { producto_id: id });
    return NextResponse.json({ producto_id: id, tramos: [] });
  }

  const rows = val.tramos.map((t, idx) => ({
    tenant_id: session.tenantId,
    producto_id: id,
    cantidad_desde: t.cantidad_desde,
    ganancia_pct: t.ganancia_pct,
    orden: idx,
  }));

  const ins = await session.supabase
    .from('producto_ganancia_tramo')
    .insert(rows)
    .select('id, cantidad_desde, ganancia_pct, orden');
  if (ins.error) {
    debugGananciaTramos('PUT insert falló', {
      producto_id: id,
      message: ins.error.message,
      rows_sent: rows,
    });
    return NextResponse.json({ error: ins.error.message }, { status: 500 });
  }

  const tramos = (ins.data ?? []).map((r) => ({
    id: r.id,
    cantidad_desde: Number(r.cantidad_desde),
    ganancia_pct: Number(r.ganancia_pct),
    orden: typeof r.orden === 'number' ? r.orden : Number(r.orden) || 0,
  }));

  debugGananciaTramos('PUT insert ok', {
    producto_id: id,
    count: tramos.length,
    tramos: tramos.map((t) => ({
      cantidad_desde: t.cantidad_desde,
      ganancia_pct: t.ganancia_pct,
      orden: t.orden,
    })),
  });

  return NextResponse.json({ producto_id: id, tramos });
}

