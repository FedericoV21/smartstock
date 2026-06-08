import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { anularComprobanteSinCae } from '@/lib/facturacion/anular-comprobante-sin-cae';
import { moduloGuardAny } from '@/lib/modulos/guard';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await moduloGuardAny(['facturador_arca', 'facturador_simple', 'facturador_pos']);
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const { id } = await params;

  let motivo: string | undefined;
  try {
    const body = (await request.json()) as { motivo?: unknown };
    motivo = typeof body.motivo === 'string' ? body.motivo : undefined;
  } catch {
    return NextResponse.json({ error: 'Cuerpo JSON inválido. Enviá { "motivo": "…" }.' }, { status: 400 });
  }

  const r = await anularComprobanteSinCae(
    session.supabase,
    {
      tenantId: session.tenantId,
      userId: session.userId,
    },
    id,
    motivo ?? '',
  );

  if (!r.ok) {
    return NextResponse.json({ error: r.error }, { status: r.status });
  }
  return NextResponse.json({ ok: true });
}
