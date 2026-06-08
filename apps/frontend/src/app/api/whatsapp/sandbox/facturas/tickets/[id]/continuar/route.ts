import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { moduloGuardAny } from '@/lib/modulos/guard';
import { MODULOS_ACCESO_LECTOR_FACTURAS } from '@/lib/modulos/modulo-key';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { continueWhatsAppSandboxInvoiceTicket } from '@/lib/whatsapp/sandbox';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await moduloGuardAny(MODULOS_ACCESO_LECTOR_FACTURAS);
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Ticket invalido.' }, { status: 400 });

  let token: string | null = null;
  try {
    const body = (await request.json()) as { token?: unknown };
    token = typeof body.token === 'string' ? body.token.trim() || null : null;
  } catch {
    token = null;
  }

  const db = createServiceRoleClient() as any;
  try {
    const result = await continueWhatsAppSandboxInvoiceTicket({
      db,
      tenantId: session.tenantId,
      userId: session.userId,
      ticketId: id,
      token,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
