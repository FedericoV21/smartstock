import { NextResponse, type NextRequest } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';
import { hoyEnAR } from '@/lib/utils/formatters';
import type { Database } from '@/types/database';

type EstadoPedido = Database['public']['Enums']['estado_pedido'];
const ESTADOS_PEDIDO: EstadoPedido[] = ['borrador', 'confirmado', 'entregado', 'cancelado'];

const selectPedido = `
  *,
  cliente:cliente_id(nombre, razon_social),
  usuario:usuario_id(nombre, apellido),
  items:pedido_item(id, cantidad, precio_unitario, subtotal, producto:producto_id(nombre, codigo))
`;

export async function GET(request: NextRequest) {
  const guard = await moduloGuard('pedidos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const { searchParams } = new URL(request.url);
  const estado = searchParams.get('estado');
  const clienteId = searchParams.get('cliente_id');
  const pagina = Math.max(1, parseInt(searchParams.get('pagina') ?? '1', 10));
  const porPagina = Math.min(100, Math.max(1, parseInt(searchParams.get('por_pagina') ?? '25', 10)));
  const offset = (pagina - 1) * porPagina;

  let query = session.supabase
    .from('pedido')
    .select(selectPedido, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + porPagina - 1);

  if (estado && ESTADOS_PEDIDO.includes(estado as EstadoPedido)) {
    query = query.eq('estado', estado as EstadoPedido);
  }
  if (clienteId) query = query.eq('cliente_id', clienteId);

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    pedidos: data ?? [],
    total: count ?? 0,
    pagina,
    por_pagina: porPagina,
  });
}

export async function POST(request: Request) {
  const guard = await moduloGuard('pedidos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

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

  const itemsRaw = b.items;
  if (!Array.isArray(itemsRaw) || itemsRaw.length === 0) {
    return NextResponse.json({ error: 'El pedido debe tener al menos un item' }, { status: 400 });
  }

  const items: { producto_id: string; cantidad: number; precio_unitario: number }[] = [];
  for (const row of itemsRaw) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const r = row as Record<string, unknown>;
    const producto_id = typeof r.producto_id === 'string' ? r.producto_id : '';
    const cantidad = Number(r.cantidad);
    const precio_unitario = Number(r.precio_unitario);
    if (!producto_id || cantidad <= 0 || precio_unitario < 0 || Number.isNaN(cantidad) || Number.isNaN(precio_unitario)) {
      return NextResponse.json(
        { error: 'Cada item requiere producto_id, cantidad > 0 y precio_unitario >= 0' },
        { status: 400 }
      );
    }
    items.push({ producto_id, cantidad, precio_unitario });
  }

  if (items.length === 0) {
    return NextResponse.json({ error: 'El pedido debe tener al menos un item válido' }, { status: 400 });
  }

  const cliente_id =
    typeof b.cliente_id === 'string' && b.cliente_id ? b.cliente_id : null;

  const total = items.reduce((sum, i) => sum + i.cantidad * i.precio_unitario, 0);

  const { data: pedido, error: pedidoError } = await session.supabase
    .from('pedido')
    .insert({
      tenant_id: session.tenantId,
      cliente_id,
      estado: 'borrador',
      fecha: hoyEnAR(),
      total: Math.round(total * 100) / 100,
      notas: typeof b.notas === 'string' && b.notas.trim() ? b.notas.trim() : null,
      usuario_id: session.userId,
    })
    .select()
    .single();

  if (pedidoError) {
    return NextResponse.json({ error: pedidoError.message }, { status: 500 });
  }

  const itemsInsert = items.map((item) => ({
    pedido_id: pedido.id,
    producto_id: item.producto_id,
    cantidad: item.cantidad,
    precio_unitario: item.precio_unitario,
    subtotal: Math.round(item.cantidad * item.precio_unitario * 100) / 100,
  }));

  const { error: itemsError } = await session.supabase.from('pedido_item').insert(itemsInsert);

  if (itemsError) {
    await session.supabase.from('pedido').delete().eq('id', pedido.id);
    return NextResponse.json({ error: itemsError.message }, { status: 500 });
  }

  return NextResponse.json(pedido, { status: 201 });
}
