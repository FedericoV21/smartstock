import { NextResponse } from 'next/server';

import { idsSucursalesOperables } from '@/lib/api/sucursal-scope';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';
import type { Database } from '@/types/database';

/** Depósitos operables donde aún no hay fila `stock_sucursal` para este producto (habilitar venta/stock). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await moduloGuard('stock');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const operable = await idsSucursalesOperables(session);
  if (!operable.ok) return operable.response;

  const { id: productoId } = await params;

  const { data: prod, error: pErr } = await session.supabase
    .from('producto')
    .select('id, sucursal_id')
    .eq('id', productoId)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();

  if (pErr) {
    return NextResponse.json({ error: pErr.message }, { status: 500 });
  }
  if (!prod?.sucursal_id) {
    return NextResponse.json({ error: 'Producto no encontrado' }, { status: 404 });
  }
  if (!operable.ids.includes(prod.sucursal_id)) {
    return NextResponse.json({ error: 'No tenés permisos para este producto.' }, { status: 403 });
  }

  const { data: ssRows, error: sErr } = await session.supabase
    .from('stock_sucursal')
    .select('sucursal_id')
    .eq('producto_id', productoId)
    .eq('tenant_id', session.tenantId)
    .in('sucursal_id', operable.ids);

  if (sErr) {
    return NextResponse.json({ error: sErr.message }, { status: 500 });
  }

  const conFila = new Set((ssRows ?? []).map((r) => r.sucursal_id));
  const idsFaltan = operable.ids.filter((sid) => !conFila.has(sid));

  if (idsFaltan.length === 0) {
    return NextResponse.json({ sucursales_sin_stock_row: [] as { id: string; codigo: string; nombre: string }[] });
  }

  const { data: sucs, error: suErr } = await session.supabase
    .from('sucursal')
    .select('id, codigo, nombre')
    .eq('tenant_id', session.tenantId)
    .eq('activa', true)
    .in('id', idsFaltan);

  if (suErr) {
    return NextResponse.json({ error: suErr.message }, { status: 500 });
  }

  return NextResponse.json({
    sucursales_sin_stock_row: (sucs ?? []).map((s) => ({
      id: s.id,
      codigo: s.codigo,
      nombre: s.nombre,
    })),
  });
}

/**
 * Crea fila `stock_sucursal` en un depósito operable (stock 0) si no existe.
 * Body: `{ sucursal_id: string }`
 */
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

  const operable = await idsSucursalesOperables(session);
  if (!operable.ok) return operable.response;

  const { id: productoId } = await params;

  const { data: prod, error: pErr } = await session.supabase
    .from('producto')
    .select('id, sucursal_id')
    .eq('id', productoId)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();

  if (pErr) {
    return NextResponse.json({ error: pErr.message }, { status: 500 });
  }
  if (!prod?.sucursal_id) {
    return NextResponse.json({ error: 'Producto no encontrado' }, { status: 404 });
  }
  if (!operable.ids.includes(prod.sucursal_id)) {
    return NextResponse.json({ error: 'No tenés permisos para este producto.' }, { status: 403 });
  }

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

  const sucursalId = typeof b.sucursal_id === 'string' ? b.sucursal_id.trim() : '';
  if (!sucursalId) {
    return NextResponse.json({ error: 'sucursal_id es obligatorio.' }, { status: 400 });
  }
  if (!operable.ids.includes(sucursalId)) {
    return NextResponse.json({ error: 'No tenés permisos para ese depósito.' }, { status: 403 });
  }

  const { data: existente, error: exErr } = await session.supabase
    .from('stock_sucursal')
    .select('id, sucursal_id, stock_actual, stock_minimo, ubicacion')
    .eq('producto_id', productoId)
    .eq('sucursal_id', sucursalId)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();

  if (exErr) {
    return NextResponse.json({ error: exErr.message }, { status: 400 });
  }
  if (existente) {
    return NextResponse.json({ ok: true, already_existed: true, stock_sucursal: existente });
  }

  const insert: Database['public']['Tables']['stock_sucursal']['Insert'] = {
    tenant_id: session.tenantId,
    producto_id: productoId,
    sucursal_id: sucursalId,
    stock_actual: 0,
    stock_minimo: 0,
    ubicacion: null,
  };

  const { data, error } = await session.supabase.from('stock_sucursal').insert(insert).select().single();

  if (error) {
    if (error.code === '23505') {
      const { data: row } = await session.supabase
        .from('stock_sucursal')
        .select('id, sucursal_id, stock_actual, stock_minimo, ubicacion')
        .eq('producto_id', productoId)
        .eq('sucursal_id', sucursalId)
        .eq('tenant_id', session.tenantId)
        .maybeSingle();
      return NextResponse.json({ ok: true, already_existed: true, stock_sucursal: row });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, stock_sucursal: data }, { status: 201 });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await moduloGuard('stock');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const operable = await idsSucursalesOperables(session);
  if (!operable.ok) return operable.response;

  const { id: productoId } = await params;

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

  const sucursalId = typeof b.sucursal_id === 'string' ? b.sucursal_id.trim() : '';
  if (!sucursalId) {
    return NextResponse.json({ error: 'sucursal_id es obligatorio.' }, { status: 400 });
  }
  if (!operable.ids.includes(sucursalId)) {
    return NextResponse.json({ error: 'No tenés permisos para ese depósito.' }, { status: 403 });
  }

  const updates: Database['public']['Tables']['stock_sucursal']['Update'] = {};

  if (b.stock_minimo !== undefined) {
    const n = Number(b.stock_minimo);
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json({ error: 'stock_minimo inválido' }, { status: 400 });
    }
    updates.stock_minimo = n;
  }

  if (b.ubicacion !== undefined) {
    updates.ubicacion =
      b.ubicacion === null || b.ubicacion === ''
        ? null
        : String(b.ubicacion).trim() || null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Sin cambios' }, { status: 400 });
  }

  const { data, error } = await session.supabase
    .from('stock_sucursal')
    .update(updates)
    .eq('producto_id', productoId)
    .eq('sucursal_id', sucursalId)
    .eq('tenant_id', session.tenantId)
    .select()
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (!data) {
    return NextResponse.json(
      { error: 'No hay registro de stock para este producto en esa sucursal.' },
      { status: 404 },
    );
  }

  return NextResponse.json(data);
}
