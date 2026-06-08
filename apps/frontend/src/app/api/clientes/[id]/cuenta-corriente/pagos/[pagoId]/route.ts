import { NextResponse, type NextRequest } from 'next/server';

import { rejectUnlessAccesoClientesApi, rejectUnlessClienteEdicion } from '@/lib/api/permissions';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { actualizarPagoExtracto } from '@/lib/cuenta-corriente/actualizar-pago-extracto';
import { moduloGuard } from '@/lib/modulos/guard';

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; pagoId: string }> },
) {
  const guard = await moduloGuard('facturador_simple');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const deniedEdit = await rejectUnlessClienteEdicion(session.supabase, session);
  if (deniedEdit) return deniedEdit;

  const deniedCli = await rejectUnlessAccesoClientesApi(session.supabase, session);
  if (deniedCli) return deniedCli;

  const { id: clienteId, pagoId } = await ctx.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const raw = body as {
    monto?: number;
    fecha?: string;
    tipo_pago?: string;
    referencia?: string | null;
    notas?: string | null;
  };

  const tipo = (raw.tipo_pago ?? 'efectivo').trim() as
    | 'efectivo'
    | 'transferencia'
    | 'cheque'
    | 'tarjeta'
    | 'otro';
  const tipos = ['efectivo', 'transferencia', 'cheque', 'tarjeta', 'otro'] as const;
  if (!tipos.includes(tipo)) {
    return NextResponse.json({ error: 'Tipo de pago inválido.' }, { status: 400 });
  }

  const { data: pago, error: pagoErr } = await session.supabase
    .from('pago')
    .select('id, cliente_id')
    .eq('id', pagoId)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();

  if (pagoErr || !pago) {
    return NextResponse.json({ error: 'Pago no encontrado.' }, { status: 404 });
  }
  if (pago.cliente_id !== clienteId) {
    return NextResponse.json({ error: 'El pago no corresponde a este cliente.' }, { status: 400 });
  }

  const result = await actualizarPagoExtracto(session.supabase, {
    pagoId,
    monto: Number(raw.monto),
    fecha: String(raw.fecha ?? '').trim(),
    tipo_pago: tipo,
    referencia: raw.referencia,
    notas: raw.notas,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, delta: result.delta });
}
