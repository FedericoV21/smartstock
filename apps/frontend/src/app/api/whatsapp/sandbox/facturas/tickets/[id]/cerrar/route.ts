import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { moduloGuardAny } from '@/lib/modulos/guard';
import { MODULOS_ACCESO_LECTOR_FACTURAS } from '@/lib/modulos/modulo-key';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { closeWhatsAppSandboxInvoiceTicket } from '@/lib/whatsapp/sandbox';

export const dynamic = 'force-dynamic';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await moduloGuardAny(MODULOS_ACCESO_LECTOR_FACTURAS);
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Ticket invalido.' }, { status: 400 });

  const db = createServiceRoleClient() as any;
  try {
    const result = await closeWhatsAppSandboxInvoiceTicket({
      db,
      tenantId: session.tenantId,
      userId: session.userId,
      ticketId: id,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
