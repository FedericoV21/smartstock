import { NextResponse } from 'next/server';

import { getTenantSession } from '@/lib/api/tenant-session';
import { moduloGuardAny } from '@/lib/modulos/guard';
import { MODULOS_ACCESO_LECTOR_FACTURAS } from '@/lib/modulos/modulo-key';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { listWhatsAppSandboxInvoiceTickets } from '@/lib/whatsapp/sandbox';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const guard = await moduloGuardAny(MODULOS_ACCESO_LECTOR_FACTURAS);
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get('limit') ?? 30);
  const db = createServiceRoleClient() as any;

  try {
    const tickets = await listWhatsAppSandboxInvoiceTickets({
      db,
      tenantId: session.tenantId,
      userId: session.userId,
      limit,
    });
    return NextResponse.json({ tickets });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
