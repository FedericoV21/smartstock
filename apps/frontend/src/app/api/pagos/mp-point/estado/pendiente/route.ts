import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';

/** Último comprobante del tenant en cobro MP Point pendiente (para banner de recuperación en el POS). */
export async function GET() {
  const guard = await moduloGuard('facturador_pos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const { data: comprobante, error } = await session.supabase
    .from('comprobante')
    .select('id, total, mp_point_intent_id')
    .eq('tenant_id', session.tenantId)
    .eq('estado', 'pendiente_posnet')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!comprobante?.mp_point_intent_id) {
    return NextResponse.json({ comprobante_id: null });
  }

  return NextResponse.json({
    comprobante_id: comprobante.id,
    total: Number(comprobante.total),
    intent_id: comprobante.mp_point_intent_id,
  });
}
