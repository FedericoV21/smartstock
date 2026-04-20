import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';
import { hoyEnAR } from '@/lib/utils/formatters';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await moduloGuard('presupuestos');
  if (!guard.allowed) return guard.response;

  const pedidoGuard = await moduloGuard('pedidos');
  if (!pedidoGuard.allowed) return pedidoGuard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const { id } = await params;

  const { data: presupuesto, error: presErr } = await session.supabase
    .from('comprobante')
    .select('*, items:comprobante_item(producto_id, cantidad, precio_unitario, subtotal)')
    .eq('id', id)
    .eq('tipo', 'presupuesto')
    .maybeSingle();

  if (presErr) {
    return NextResponse.json({ error: presErr.message }, { status: 500 });
  }
  if (!presupuesto) {
    return NextResponse.json({ error: 'Presupuesto no encontrado' }, { status: 404 });
  }

  if (presupuesto.estado === 'anulado') {
    return NextResponse.json({ error: 'El presupuesto está anulado' }, { status: 400 });
  }

  const items = (presupuesto as { items: { producto_id: string; cantidad: number; precio_unitario: number; subtotal: number }[] }).items ?? [];
  if (items.length === 0) {
    return NextResponse.json({ error: 'El presupuesto no tiene ítems' }, { status: 400 });
  }

  const { data: pedido, error: pedidoError } = await session.supabase
    .from('pedido')
    .insert({
      tenant_id: session.tenantId,
      cliente_id: presupuesto.cliente_id,
      estado: 'borrador',
      fecha: hoyEnAR(),
      total: presupuesto.total,
      notas: `Generado desde presupuesto #${presupuesto.numero}`,
      usuario_id: session.userId,
    })
    .select()
    .single();

  if (pedidoError) {
    return NextResponse.json({ error: pedidoError.message }, { status: 500 });
  }

  const itemsInsert = items.map((i) => ({
    pedido_id: pedido.id,
    producto_id: i.producto_id,
    cantidad: i.cantidad,
    precio_unitario: i.precio_unitario,
    subtotal: i.subtotal,
  }));

  const { error: itemsError } = await session.supabase.from('pedido_item').insert(itemsInsert);

  if (itemsError) {
    await session.supabase.from('pedido').delete().eq('id', pedido.id);
    return NextResponse.json({ error: itemsError.message }, { status: 500 });
  }

  return NextResponse.json(
    {
      presupuesto_id: presupuesto.id,
      pedido_id: pedido.id,
    },
    { status: 201 }
  );
}
