import { NextResponse } from 'next/server';

import { createServerClient, createServiceRoleClient } from '@/lib/supabase/server';
import { normalizeLocalUsername, verifyPin } from '@/lib/auth/local-credentials';
import { apiErrorPayload } from '@/lib/errors/user-copy';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const tenantId = String(b.tenantId ?? '').trim();
  const tenantCode = String(b.tenantCode ?? '').trim().toLowerCase();
  const username = normalizeLocalUsername(String(b.username ?? ''));
  const pin = String(b.pin ?? '');

  if ((!tenantId && !tenantCode) || !username || !pin) {
    return NextResponse.json(
      { error: 'tenantCode (o tenantId), username y pin son obligatorios.' },
      { status: 400 },
    );
  }

  const supabase = await createServerClient();
  const admin = createServiceRoleClient();
  const adminDb = admin as any;
  let resolvedTenantId = tenantId;

  if (!resolvedTenantId && tenantCode) {
    const { data: tenant, error: tenantErr } = await adminDb
      .from('tenant')
      .select('id')
      .eq('codigo_acceso', tenantCode)
      .maybeSingle();

    if (tenantErr) {
      return NextResponse.json(
        apiErrorPayload('auth', tenantErr.message, 'No pudimos validar el código del negocio.'),
        { status: 500 },
      );
    }
    if (!tenant) {
      return NextResponse.json({ error: 'Credenciales inválidas.' }, { status: 401 });
    }
    resolvedTenantId = tenant.id;
  }

  const { data: cred, error: credErr } = await adminDb
    .from('usuario_credencial_local')
    .select(
      'usuario_id, tenant_id, pin_hash, activo, bloqueado_hasta, intentos_fallidos',
    )
    .eq('tenant_id', resolvedTenantId)
    .ilike('username_local', username)
    .maybeSingle();

  if (credErr) {
    return NextResponse.json(
      apiErrorPayload('auth', credErr.message, 'No pudimos validar las credenciales locales.'),
      { status: 500 },
    );
  }
  if (!cred) {
    return NextResponse.json({ error: 'Credenciales inválidas.' }, { status: 401 });
  }
  const credRow = cred as {
    usuario_id: string;
    pin_hash: string;
    activo: boolean;
    bloqueado_hasta: string | null;
    intentos_fallidos: number | null;
  };
  const { data: usuario, error: usuarioErr } = await adminDb
    .from('usuario')
    .select('email, activo')
    .eq('id', credRow.usuario_id)
    .eq('tenant_id', resolvedTenantId)
    .maybeSingle();

  if (usuarioErr) {
    return NextResponse.json(
      apiErrorPayload('auth', usuarioErr.message, 'No pudimos validar el usuario para iniciar sesión.'),
      { status: 500 },
    );
  }
  if (!usuario) {
    return NextResponse.json({ error: 'Credenciales inválidas.' }, { status: 401 });
  }
  if (!credRow.activo || !usuario.activo) {
    return NextResponse.json({ error: 'Usuario inactivo.' }, { status: 403 });
  }

  if (credRow.bloqueado_hasta && new Date(credRow.bloqueado_hasta).getTime() > Date.now()) {
    return NextResponse.json({ error: 'Usuario temporalmente bloqueado.' }, { status: 423 });
  }

  const pinOk = await verifyPin(pin, credRow.pin_hash);
  if (!pinOk) {
    const nextAttempts = (credRow.intentos_fallidos ?? 0) + 1;
    const shouldLock = nextAttempts >= MAX_FAILED_ATTEMPTS;

    await adminDb
      .from('usuario_credencial_local')
      .update({
        intentos_fallidos: shouldLock ? 0 : nextAttempts,
        bloqueado_hasta: shouldLock
          ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000).toISOString()
          : null,
      })
      .eq('usuario_id', credRow.usuario_id);

    return NextResponse.json({ error: 'Credenciales inválidas.' }, { status: 401 });
  }

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: usuario.email,
    password: pin,
  });

  if (signInError) {
    return NextResponse.json({ error: 'No se pudo iniciar sesión.' }, { status: 401 });
  }

  await adminDb
    .from('usuario_credencial_local')
    .update({
      intentos_fallidos: 0,
      bloqueado_hasta: null,
      ultimo_login_at: new Date().toISOString(),
    })
    .eq('usuario_id', credRow.usuario_id);

  return NextResponse.json({ success: true });
}

