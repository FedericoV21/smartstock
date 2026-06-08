import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { revertirFacturaImportada } from '@/lib/lector-facturas/revertir-factura-importada';
import { moduloGuardAny } from '@/lib/modulos/guard';
import { MODULOS_ACCESO_LECTOR_FACTURAS } from '@/lib/modulos/modulo-key';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await moduloGuardAny([...MODULOS_ACCESO_LECTOR_FACTURAS, 'facturador_simple']);
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
    return NextResponse.json({ error: 'Cuerpo JSON invalido. Envia { "motivo": "..." }.' }, { status: 400 });
  }

  const r = await revertirFacturaImportada(
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
  return NextResponse.json({ ok: true, resumen: r.resumen });
}
