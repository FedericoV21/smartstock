import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { moduloGuardAny } from '@/lib/modulos/guard';
import { MODULOS_ACCESO_LECTOR_FACTURAS } from '@/lib/modulos/modulo-key';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { linkWhatsAppSandboxInvoiceTicketItem } from '@/lib/whatsapp/sandbox';

export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await moduloGuardAny(MODULOS_ACCESO_LECTOR_FACTURAS);
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON invalido.' }, { status: 400 });
  }

  const payload =
    body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const itemIndice = Number(payload.item_indice ?? payload.indice);
  const productoId = typeof payload.producto_id === 'string' ? payload.producto_id.trim() : '';
  if (!id) return NextResponse.json({ error: 'Ticket invalido.' }, { status: 400 });
  if (!Number.isInteger(itemIndice) || itemIndice < 0) {
    return NextResponse.json({ error: 'item_indice invalido.' }, { status: 400 });
  }
  if (!productoId) return NextResponse.json({ error: 'producto_id es obligatorio.' }, { status: 400 });

  const db = createServiceRoleClient() as any;
  try {
    const result = await linkWhatsAppSandboxInvoiceTicketItem({
      db,
      tenantId: session.tenantId,
      userId: session.userId,
      ticketId: id,
      itemIndice,
      productoId,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
