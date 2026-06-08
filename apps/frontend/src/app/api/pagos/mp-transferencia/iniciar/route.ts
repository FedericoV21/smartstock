import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { loadMpTransferenciaAccessToken } from '@/lib/mp-transferencia/service';
import { moduloGuard } from '@/lib/modulos/guard';
import { createServiceRoleClient } from '@/lib/supabase/server';

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

  const adminDb = createServiceRoleClient();
  const { data: comp, error: compErr } = await adminDb
    .from('comprobante')
    .select('id, tenant_id, sucursal_id, caja_id, estado, total')
    .eq('id', comprobanteId)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();

  if (compErr || !comp) {
    return NextResponse.json({ error: 'Comprobante no encontrado' }, { status: 404 });
  }

  if (!comp.sucursal_id) {
    return NextResponse.json({ error: 'El borrador no tiene sucursal asociada' }, { status: 400 });
  }
  if (!comp.caja_id) {
    return NextResponse.json({ error: 'El borrador no tiene caja asociada' }, { status: 400 });
  }

  if (comp.estado !== 'borrador' && comp.estado !== 'pendiente_transferencia_mp') {
    return NextResponse.json(
      { error: 'Solo se puede verificar Transferencia MP sobre un borrador o una verificacion en curso.' },
      { status: 400 },
    );
  }

  const totalDb = Number(comp.total);
  if (!Number.isFinite(totalDb) || totalDb <= 0) {
    return NextResponse.json(
      { error: 'El borrador no tiene un total valido para verificar Transferencia MP' },
      { status: 400 },
    );
  }

  const token = await loadMpTransferenciaAccessToken(adminDb, {
    tenantId: session.tenantId,
    sucursalId: String(comp.sucursal_id),
    cajaId: String(comp.caja_id),
  });
  if (!token.ok) {
    return NextResponse.json({ error: token.error }, { status: token.status });
  }

  if (comp.estado === 'borrador') {
    const { error: upErr } = await adminDb
      .from('comprobante')
      .update({
        estado: 'pendiente_transferencia_mp' as never,
        metodo_pago: 'transferencia_mp' as never,
      })
      .eq('id', comprobanteId)
      .eq('tenant_id', session.tenantId);

    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    comprobante_id: comprobanteId,
    estado: 'pendiente_transferencia_mp',
    monto_terminal_pesos: Math.round(totalDb * 100) / 100,
  });
}
