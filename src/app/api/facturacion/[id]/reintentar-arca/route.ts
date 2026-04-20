import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { reintentarCaeComprobante } from '@/lib/facturacion/reintentar-cae-comprobante';
import { moduloGuard } from '@/lib/modulos/guard';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await moduloGuard('facturador_arca');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const { id } = await params;
  const result = await reintentarCaeComprobante(session.supabase, { tenantId: session.tenantId }, id);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    cae: result.cae,
    cae_vencimiento: result.cae_vencimiento,
    pdf_url: result.pdf_url,
  });
}
