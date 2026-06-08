import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { confirmarTransferenciaMp } from '@/lib/mp-transferencia/service';
import { moduloGuard } from '@/lib/modulos/guard';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const maxDuration = 60;

export async function POST(request: Request) {
  const guard = await moduloGuard('facturador_pos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  let body: { comprobante_id?: string; movimiento_id?: string };
  try {
    body = (await request.json()) as { comprobante_id?: string; movimiento_id?: string };
  } catch {
    return NextResponse.json({ error: 'JSON invalido' }, { status: 400 });
  }

  const comprobanteId = body.comprobante_id?.trim();
  const movimientoId = body.movimiento_id?.trim();
  if (!comprobanteId || !movimientoId) {
    return NextResponse.json(
      { error: 'comprobante_id y movimiento_id son obligatorios' },
      { status: 400 },
    );
  }

  const adminDb = createServiceRoleClient();
  const { data: comp, error: compErr } = await adminDb
    .from('comprobante')
    .select('id, tenant_id, sucursal_id, estado, total')
    .eq('id', comprobanteId)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();

  if (compErr || !comp) {
    return NextResponse.json({ error: 'Comprobante no encontrado' }, { status: 404 });
  }

  if (!comp.sucursal_id) {
    return NextResponse.json({ error: 'El comprobante no tiene sucursal asociada' }, { status: 400 });
  }
  if (comp.estado !== 'pendiente_transferencia_mp') {
    return NextResponse.json(
      { error: 'El comprobante no esta esperando verificacion de Transferencia MP' },
      { status: 400 },
    );
  }

  const result = await confirmarTransferenciaMp(adminDb, {
    tenantId: session.tenantId,
    userId: session.userId,
    comprobante: {
      id: String(comp.id),
      tenant_id: String(comp.tenant_id),
      sucursal_id: String(comp.sucursal_id),
      estado: String(comp.estado),
      total: comp.total,
    },
    movimientoId,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(
    {
      comprobante: result.data.comprobante,
      sucursal_id: comp.sucursal_id,
      importes: result.data.importes,
      promociones_aplicadas: result.data.promociones_aplicadas,
      qr_url: result.data.qr_url,
      ...(result.data.linea_caja_ticket
        ? { linea_caja_ticket: result.data.linea_caja_ticket }
        : {}),
      ...(result.data.productos_creados?.length
        ? { productos_creados: result.data.productos_creados }
        : {}),
    },
    { status: 201 },
  );
}
