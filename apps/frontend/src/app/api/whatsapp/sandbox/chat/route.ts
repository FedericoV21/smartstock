import { NextResponse } from 'next/server';

import { getTenantSession } from '@/lib/api/tenant-session';
import { moduloGuardAny } from '@/lib/modulos/guard';
import { MODULOS_ACCESO_LECTOR_FACTURAS } from '@/lib/modulos/modulo-key';
import { createServiceRoleClient } from '@/lib/supabase/server';
import {
  clearWhatsAppSandboxChat,
  loadWhatsAppSandboxMessages,
  sandboxRoleFromSession,
  sendWhatsAppSandboxChatMessage,
} from '@/lib/whatsapp/sandbox';

export const dynamic = 'force-dynamic';

async function getAuthorizedSession() {
  const guard = await moduloGuardAny([...MODULOS_ACCESO_LECTOR_FACTURAS, 'importador_excel']);
  if (!guard.allowed) return { error: guard.response };

  const session = await getTenantSession();
  if ('error' in session) return { error: session.error };

  return { session };
}

export async function GET() {
  const auth = await getAuthorizedSession();
  if ('error' in auth) return auth.error;

  const db = createServiceRoleClient() as any;
  try {
    const messages = await loadWhatsAppSandboxMessages({
      db,
      tenantId: auth.session.tenantId,
      userId: auth.session.userId,
    });
    return NextResponse.json({ messages });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await getAuthorizedSession();
  if ('error' in auth) return auth.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON invalido.' }, { status: 400 });
  }

  const payload =
    body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const message = String(payload.message ?? '').trim();
  if (!message) {
    return NextResponse.json({ error: 'El mensaje no puede estar vacio.' }, { status: 400 });
  }
  if (message.length > 2000) {
    return NextResponse.json({ error: 'El mensaje es demasiado largo.' }, { status: 400 });
  }

  const db = createServiceRoleClient() as any;
  try {
    const result = await sendWhatsAppSandboxChatMessage({
      db,
      tenantId: auth.session.tenantId,
      userId: auth.session.userId,
      role: sandboxRoleFromSession({
        rol: auth.session.rol,
        isSuperAdmin: auth.session.isSuperAdmin,
      }),
      content: message,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE() {
  const auth = await getAuthorizedSession();
  if ('error' in auth) return auth.error;

  const db = createServiceRoleClient() as any;
  try {
    await clearWhatsAppSandboxChat({
      db,
      tenantId: auth.session.tenantId,
      userId: auth.session.userId,
    });
    return NextResponse.json({ ok: true, messages: [] });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
