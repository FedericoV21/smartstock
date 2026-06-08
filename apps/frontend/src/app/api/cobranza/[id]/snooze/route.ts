import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';

const HORAS_DEFAULT = 24;

/** Quita el posponer: la factura vuelve a aparecer en la campana si corresponde por reglas de cobro. */
export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const guard = await moduloGuard('facturador_simple');
  if (!guard.allowed) return guard.response;

  const { id } = await ctx.params;

  const { data, error } = await session.supabase
    .from('cobranza_factura')
    .update({ recordatorio_snooze_until: null })
    .eq('id', id)
    .gt('saldo_pendiente', 0)
    .select('id')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Cobranza no encontrada o ya saldada' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

/** Pospone el recordatorio en la campana (no cambia el vencimiento de pago). */
export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const guard = await moduloGuard('facturador_simple');
  if (!guard.allowed) return guard.response;

  const { id } = await ctx.params;
  const hasta = new Date(Date.now() + HORAS_DEFAULT * 60 * 60 * 1000).toISOString();

  const { data, error } = await session.supabase
    .from('cobranza_factura')
    .update({ recordatorio_snooze_until: hasta })
    .eq('id', id)
    .gt('saldo_pendiente', 0)
    .select('id')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Cobranza no encontrada o ya saldada' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, recordatorio_snooze_until: hasta, horas: HORAS_DEFAULT });
}
