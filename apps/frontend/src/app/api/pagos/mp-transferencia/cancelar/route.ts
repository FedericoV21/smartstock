import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';

export async function POST(request: Request) {
  const guard = await moduloGuard('facturador_pos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  let body: { comprobante_id?: string };
  try {
    body = (await request.json()) as { comprobante_id?: string };
  } catch {
    return NextResponse.json({ error: 'JSON invalido' }, { status: 400 });
  }

  const comprobanteId = body.comprobante_id?.trim();
  if (!comprobanteId) {
    return NextResponse.json({ error: 'comprobante_id es obligatorio' }, { status: 400 });
  }

  const { data: comp, error: compErr } = await session.supabase
    .from('comprobante')
    .select('id, tenant_id, estado')
    .eq('id', comprobanteId)
    .maybeSingle();

  if (compErr || !comp || comp.tenant_id !== session.tenantId) {
    return NextResponse.json({ error: 'Comprobante no encontrado' }, { status: 404 });
  }

  if (comp.estado === 'borrador') {
    return NextResponse.json({ mensaje: 'Verificacion cancelada' });
  }
  if (comp.estado !== 'pendiente_transferencia_mp') {
    return NextResponse.json(
      { error: 'El comprobante no esta esperando verificacion de Transferencia MP' },
      { status: 400 },
    );
  }

  const { error: delReservasErr } = await (session.supabase as SupabaseClient)
    .from('mp_transferencia_verificacion')
    .delete()
    .eq('tenant_id', session.tenantId)
    .eq('comprobante_id', comprobanteId)
    .in('estado', ['reservado', 'error']);

  if (delReservasErr) {
    return NextResponse.json({ error: delReservasErr.message }, { status: 500 });
  }

  const { error: upErr } = await session.supabase
    .from('comprobante')
    .update({
      estado: 'borrador' as never,
      metodo_pago: null,
      metodo_pago_detalle: null,
    })
    .eq('id', comprobanteId)
    .eq('tenant_id', session.tenantId);

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  return NextResponse.json({ mensaje: 'Verificacion cancelada' });
}
