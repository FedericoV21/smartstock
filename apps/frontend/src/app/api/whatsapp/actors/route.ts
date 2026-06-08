import { NextResponse } from 'next/server';

import { getTenantSession } from '@/lib/api/tenant-session';
import { moduloGuardAny } from '@/lib/modulos/guard';
import { MODULOS_ACCESO_LECTOR_FACTURAS } from '@/lib/modulos/modulo-key';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { removeWhatsAppActor, type RemoveWhatsAppActorMode } from '@/lib/whatsapp/actor-admin';
import { syncPlatformRoutingForVerifiedActor } from '@/lib/whatsapp/actor-lookup';
import { processWhatsAppOutboundQueue } from '@/lib/whatsapp/outbound-worker';
import { getWhatsAppPlatformPhoneNumberId } from '@/lib/whatsapp/platform-channel';
import {
  canonicalWaId,
  OTP_BLOCK_MINUTES,
  OTP_EXPIRES_MINUTES,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_RESEND_WINDOW,
  OTP_RESEND_WINDOW_MINUTES,
  generateOtpCode,
  generateOtpSalt,
  hashOtp,
  maskWaId,
  normalizeWaId,
  verifyOtpHash,
  waIdLookupVariants,
} from '@/lib/whatsapp/otp';

type TenantUser = {
  id: string;
  nombre: string;
  apellido: string;
  email: string;
  rol: string;
  activo: boolean;
};

function rejectUnlessOwnerAdmin(session: { rol: string; isSuperAdmin: boolean }) {
  if (session.isSuperAdmin || session.rol === 'admin') return null;
  return NextResponse.json(
    { error: 'Solo owner/admin puede vincular o verificar números de WhatsApp.' },
    { status: 403 },
  );
}

function parseBodyAsRecord(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  return body as Record<string, unknown>;
}

function normalizeActorRole(input: unknown): string {
  const value = String(input ?? '').trim().toLowerCase();
  if (value === 'owner' || value === 'admin' || value === 'operador' || value === 'readonly') {
    return value;
  }
  return 'operador';
}

function shouldAutoFlushOtpOutbound(): boolean {
  const raw = (process.env.WHATSAPP_OTP_AUTO_FLUSH_OUTBOUND ?? '').trim().toLowerCase();
  if (raw === '1' || raw === 'true' || raw === 'yes') return true;
  if (raw === '0' || raw === 'false' || raw === 'no') return false;
  return true;
}

async function getActiveChannelPhoneNumberId(db: any): Promise<string | null> {
  return getWhatsAppPlatformPhoneNumberId(db);
}

export async function GET() {
  const guard = await moduloGuardAny([...MODULOS_ACCESO_LECTOR_FACTURAS, 'importador_excel']);
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectUnlessOwnerAdmin(session);
  if (forbidden) return forbidden;

  const db = session.supabase as any;
  const { data: usersRows, error: usersErr } = await db
    .from('usuario')
    .select('id, nombre, apellido, email, rol, activo')
    .eq('tenant_id', session.tenantId)
    .eq('activo', true)
    .order('nombre', { ascending: true });
  if (usersErr) return NextResponse.json({ error: usersErr.message }, { status: 500 });

  const { data: actorRows, error: actorsErr } = await db
    .from('whatsapp_actor' as any)
    .select(
      'id, tenant_id, usuario_id, from_wa_id, rol_whatsapp, trust_level, activo, verified_at, created_at, replaced_by_actor_id, usuario(nombre, apellido, email, rol, activo)',
    )
    .eq('tenant_id', session.tenantId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (actorsErr) return NextResponse.json({ error: actorsErr.message }, { status: 500 });

  const visibleActorRows = (actorRows ?? []).filter(
    (row: { from_wa_id?: string | null }) => !String(row.from_wa_id ?? '').startsWith('sandbox:'),
  );
  const actorIds = Array.isArray(visibleActorRows)
    ? visibleActorRows.map((row: { id?: string }) => String(row.id ?? '')).filter(Boolean)
    : [];
  const challengesByActor = new Map<string, any>();
  if (actorIds.length > 0) {
    const { data: challengesRows, error: challengesErr } = await db
      .from('whatsapp_auth_challenge' as any)
      .select('actor_id, status, expires_at, blocked_until, attempt_count, max_attempts, created_at')
      .in('actor_id', actorIds)
      .order('created_at', { ascending: false });
    if (challengesErr) return NextResponse.json({ error: challengesErr.message }, { status: 500 });

    for (const row of challengesRows ?? []) {
      const actorId = String(row.actor_id ?? '');
      if (!actorId || challengesByActor.has(actorId)) continue;
      challengesByActor.set(actorId, row);
    }
  }

  const users = (usersRows ?? []) as TenantUser[];
  const actors = visibleActorRows.map((row: any) => ({
    id: String(row.id),
    usuario_id: String(row.usuario_id),
    from_wa_id: String(row.from_wa_id ?? ''),
    from_wa_id_masked: maskWaId(String(row.from_wa_id ?? '')),
    rol_whatsapp: String(row.rol_whatsapp ?? 'operador'),
    trust_level: String(row.trust_level ?? 'unverified'),
    activo: Boolean(row.activo),
    verified_at: row.verified_at ?? null,
    created_at: row.created_at ?? null,
    replaced_by_actor_id: row.replaced_by_actor_id ?? null,
    usuario: Array.isArray(row.usuario) ? row.usuario[0] ?? null : (row.usuario ?? null),
    latest_challenge: challengesByActor.get(String(row.id)) ?? null,
  }));

  return NextResponse.json({ users, actors });
}

async function requestOtp(params: { db: any; tenantId: string; userId: string; fromWaIdRaw: string; actorRole: string }) {
  const { db, tenantId, userId, fromWaIdRaw, actorRole } = params;
  const fromWaId = canonicalWaId(fromWaIdRaw) ?? normalizeWaId(fromWaIdRaw);
  if (!fromWaId) {
    return NextResponse.json(
      { error: 'Número de WhatsApp inválido. Usá formato internacional (solo dígitos).' },
      { status: 400 },
    );
  }

  const { data: userRow, error: userErr } = await db
    .from('usuario')
    .select('id, tenant_id, nombre, apellido, activo')
    .eq('id', userId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (userErr) return NextResponse.json({ error: userErr.message }, { status: 500 });
  if (!userRow?.id) return NextResponse.json({ error: 'Usuario no encontrado en este negocio.' }, { status: 404 });
  if (!userRow.activo) return NextResponse.json({ error: 'El usuario está inactivo.' }, { status: 400 });

  const phoneNumberId = await getActiveChannelPhoneNumberId(createServiceRoleClient() as any);
  if (!phoneNumberId) {
    return NextResponse.json(
      {
        error:
          'No hay canal WhatsApp central activo. Un super admin debe configurarlo en la bandeja de WhatsApp o via WHATSAPP_PLATFORM_PHONE_NUMBER_ID.',
      },
      { status: 409 },
    );
  }

  const variants = waIdLookupVariants(fromWaId);
  const activeLookupValues = variants.length > 0 ? variants : [fromWaId];
  const { data: activeRows, error: activeByNumberErr } = await db
    .from('whatsapp_actor' as any)
    .select('id, usuario_id, trust_level, activo, from_wa_id')
    .eq('tenant_id', tenantId)
    .in('from_wa_id', activeLookupValues)
    .eq('activo', true)
    .limit(5);
  if (activeByNumberErr) return NextResponse.json({ error: activeByNumberErr.message }, { status: 500 });

  const rows = (activeRows ?? []) as Array<{
    id: string;
    usuario_id: string;
    trust_level: string;
    activo: boolean;
    from_wa_id: string;
  }>;
  const conflicting = rows.find((row) => String(row.usuario_id) !== userId);
  if (conflicting?.id) {
    return NextResponse.json(
      {
        error:
          'Ese número ya está vinculado a otro usuario activo del negocio. Eliminalo o desvinculalo desde la tabla de vinculaciones.',
      },
      { status: 409 },
    );
  }

  const activeByNumber = rows.find((row) => String(row.from_wa_id) === fromWaId) ?? rows[0] ?? null;

  let actorId = String(activeByNumber?.id ?? '');
  if (!actorId) {
    const { data: inactiveSameUser, error: inactiveErr } = await db
      .from('whatsapp_actor' as any)
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('usuario_id', userId)
      .in('from_wa_id', activeLookupValues)
      .eq('activo', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (inactiveErr) return NextResponse.json({ error: inactiveErr.message }, { status: 500 });
    if (inactiveSameUser?.id) {
      const { error: reactivateErr } = await db
        .from('whatsapp_actor' as any)
        .update({
          activo: true,
          rol_whatsapp: actorRole,
          trust_level: 'unverified',
          verified_at: null,
        })
        .eq('id', inactiveSameUser.id)
        .eq('tenant_id', tenantId);
      if (reactivateErr) return NextResponse.json({ error: reactivateErr.message }, { status: 500 });
      actorId = String(inactiveSameUser.id);
    }
  }

  if (!actorId) {
    const { data: createdActor, error: createActorErr } = await db
      .from('whatsapp_actor' as any)
      .insert({
        tenant_id: tenantId,
        usuario_id: userId,
        from_wa_id: fromWaId,
        rol_whatsapp: actorRole,
        trust_level: 'unverified',
        activo: true,
        verified_at: null,
        replaced_by_actor_id: null,
      })
      .select('id')
      .single();
    if (createActorErr) return NextResponse.json({ error: createActorErr.message }, { status: 500 });
    actorId = String(createdActor?.id ?? '');
  } else {
    const { error: upActorErr } = await db
      .from('whatsapp_actor' as any)
      .update({
        rol_whatsapp: actorRole,
      })
      .eq('id', actorId)
      .eq('tenant_id', tenantId);
    if (upActorErr) return NextResponse.json({ error: upActorErr.message }, { status: 500 });
  }

  if (!actorId) {
    return NextResponse.json({ error: 'No se pudo preparar la vinculación del número.' }, { status: 500 });
  }

  const now = new Date();
  const windowStart = new Date(now.getTime() - OTP_RESEND_WINDOW_MINUTES * 60_000).toISOString();
  const { count: resendCount, error: resendErr } = await db
    .from('whatsapp_auth_challenge' as any)
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('actor_id', actorId)
    .gte('created_at', windowStart);
  if (resendErr) return NextResponse.json({ error: resendErr.message }, { status: 500 });
  if ((resendCount ?? 0) >= OTP_MAX_RESEND_WINDOW) {
    return NextResponse.json(
      { error: `Demasiados reenvíos. Probá nuevamente en ${OTP_RESEND_WINDOW_MINUTES} minutos.` },
      { status: 429 },
    );
  }

  const { data: lastChallenge, error: lastErr } = await db
    .from('whatsapp_auth_challenge' as any)
    .select('id, status, blocked_until')
    .eq('tenant_id', tenantId)
    .eq('actor_id', actorId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastErr) return NextResponse.json({ error: lastErr.message }, { status: 500 });
  if (
    lastChallenge?.status === 'blocked' &&
    lastChallenge?.blocked_until &&
    new Date(lastChallenge.blocked_until).getTime() > now.getTime()
  ) {
    return NextResponse.json(
      { error: 'Número temporalmente bloqueado por intentos fallidos. Esperá antes de reenviar.' },
      { status: 423 },
    );
  }

  await db
    .from('whatsapp_auth_challenge' as any)
    .update({ status: 'cancelled' })
    .eq('tenant_id', tenantId)
    .eq('actor_id', actorId)
    .eq('status', 'pending');

  const otpCode = generateOtpCode();
  const otpSalt = generateOtpSalt();
  const otpHash = hashOtp(otpCode, otpSalt);
  const expiresAt = new Date(now.getTime() + OTP_EXPIRES_MINUTES * 60_000).toISOString();

  const { data: challenge, error: challengeErr } = await db
    .from('whatsapp_auth_challenge' as any)
    .insert({
      tenant_id: tenantId,
      actor_id: actorId,
      channel_phone_number_id: phoneNumberId,
      otp_hash: otpHash,
      otp_salt: otpSalt,
      expires_at: expiresAt,
      attempt_count: 0,
      max_attempts: OTP_MAX_ATTEMPTS,
      resend_count: (resendCount ?? 0) + 1,
      status: 'pending',
      blocked_until: null,
      verified_at: null,
    })
    .select('id, expires_at')
    .single();
  if (challengeErr) return NextResponse.json({ error: challengeErr.message }, { status: 500 });

  const outboundBody = [
    `Codigo de verificacion SmartStock: ${otpCode}`,
    `Vence en ${OTP_EXPIRES_MINUTES} minutos.`,
    'Si no solicitaste este codigo, ignora este mensaje.',
  ].join('\n');

  const outboundDb = createServiceRoleClient() as any;
  const { data: outboundRow, error: outboundErr } = await outboundDb
    .from('whatsapp_outbound_message' as any)
    .insert({
      tenant_id: tenantId,
      to_wa_id: fromWaId,
      phone_number_id: phoneNumberId,
      body: outboundBody,
      status: 'queued',
    })
    .select('id')
    .single();

  if (outboundErr) {
    await db
      .from('whatsapp_auth_challenge' as any)
      .update({ status: 'cancelled' })
      .eq('id', challenge.id)
      .eq('tenant_id', tenantId);
    return NextResponse.json(
      { error: `No se pudo encolar el envio del OTP: ${outboundErr.message}` },
      { status: 500 },
    );
  }

  const outboundAutoFlush: { attempted: boolean; processed: number; sent: number; failed: number } = {
    attempted: false,
    processed: 0,
    sent: 0,
    failed: 0,
  };
  if (shouldAutoFlushOtpOutbound()) {
    outboundAutoFlush.attempted = true;
    try {
      const outboundMessageId = String(outboundRow?.id ?? '').trim();
      const stats = await processWhatsAppOutboundQueue({
        db: outboundDb,
        tenantId,
        limit: 20,
        messageIds: outboundMessageId ? [outboundMessageId] : [],
      });
      outboundAutoFlush.processed = stats.processed;
      outboundAutoFlush.sent = stats.sent;
      outboundAutoFlush.failed = stats.failed;
    } catch (e) {
      console.error('[whatsapp][actors][request_otp] outbound auto flush error', {
        tenantId,
        actorId,
        error: (e as Error).message,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    actor_id: actorId,
    challenge_id: String(challenge.id),
    expires_at: challenge.expires_at,
    to_wa_id_masked: maskWaId(fromWaId),
    outbound_auto_flush: outboundAutoFlush,
  });
}

async function verifyOtp(params: { db: any; tenantId: string; actorId: string; code: string }) {
  const { db, tenantId, actorId, code } = params;
  if (!/^\d{4,8}$/.test(code)) {
    return NextResponse.json({ error: 'El código OTP debe tener entre 4 y 8 dígitos.' }, { status: 400 });
  }

  const { data: actor, error: actorErr } = await db
    .from('whatsapp_actor' as any)
    .select('id, tenant_id, usuario_id, trust_level, activo')
    .eq('tenant_id', tenantId)
    .eq('id', actorId)
    .maybeSingle();
  if (actorErr) return NextResponse.json({ error: actorErr.message }, { status: 500 });
  if (!actor?.id) return NextResponse.json({ error: 'Vinculación no encontrada.' }, { status: 404 });

  const { data: challenge, error: challengeErr } = await db
    .from('whatsapp_auth_challenge' as any)
    .select('id, otp_hash, otp_salt, expires_at, attempt_count, max_attempts, status, blocked_until')
    .eq('tenant_id', tenantId)
    .eq('actor_id', actorId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (challengeErr) return NextResponse.json({ error: challengeErr.message }, { status: 500 });
  if (!challenge?.id) {
    return NextResponse.json({ error: 'No hay OTP pendiente para esta vinculación.' }, { status: 404 });
  }

  const now = new Date();
  if (challenge.status === 'blocked' && challenge.blocked_until) {
    const blockedUntil = new Date(challenge.blocked_until);
    if (blockedUntil.getTime() > now.getTime()) {
      return NextResponse.json(
        { error: 'Vinculación bloqueada temporalmente por intentos fallidos.' },
        { status: 423 },
      );
    }
  }

  if (challenge.status !== 'pending') {
    return NextResponse.json(
      { error: `El challenge actual está en estado "${challenge.status}". Solicitá un nuevo código.` },
      { status: 409 },
    );
  }

  if (new Date(challenge.expires_at).getTime() < now.getTime()) {
    await db
      .from('whatsapp_auth_challenge' as any)
      .update({ status: 'expired' })
      .eq('id', challenge.id)
      .eq('tenant_id', tenantId);
    return NextResponse.json({ error: 'El código expiró. Solicitá uno nuevo.' }, { status: 410 });
  }

  const ok = verifyOtpHash(code, String(challenge.otp_salt), String(challenge.otp_hash));
  if (!ok) {
    const nextAttempts = Number(challenge.attempt_count ?? 0) + 1;
    const maxAttempts = Number(challenge.max_attempts ?? OTP_MAX_ATTEMPTS);
    const shouldBlock = nextAttempts >= maxAttempts;

    const payload = shouldBlock
      ? {
          status: 'blocked',
          attempt_count: nextAttempts,
          blocked_until: new Date(now.getTime() + OTP_BLOCK_MINUTES * 60_000).toISOString(),
        }
      : { attempt_count: nextAttempts };

    await db
      .from('whatsapp_auth_challenge' as any)
      .update(payload)
      .eq('id', challenge.id)
      .eq('tenant_id', tenantId);

    if (shouldBlock) {
      await db
        .from('whatsapp_actor' as any)
        .update({ trust_level: 'blocked' })
        .eq('id', actorId)
        .eq('tenant_id', tenantId);
      return NextResponse.json(
        { error: `Demasiados intentos fallidos. Bloqueado por ${OTP_BLOCK_MINUTES} minutos.` },
        { status: 423 },
      );
    }

    return NextResponse.json(
      {
        error: 'Código incorrecto.',
        attempts_left: Math.max(0, maxAttempts - nextAttempts),
      },
      { status: 400 },
    );
  }

  const nowIso = now.toISOString();
  const { error: verifyChallengeErr } = await db
    .from('whatsapp_auth_challenge' as any)
    .update({
      status: 'verified',
      verified_at: nowIso,
      blocked_until: null,
    })
    .eq('id', challenge.id)
    .eq('tenant_id', tenantId);
  if (verifyChallengeErr) return NextResponse.json({ error: verifyChallengeErr.message }, { status: 500 });

  const { error: verifyActorErr } = await db
    .from('whatsapp_actor' as any)
    .update({
      trust_level: 'verified',
      verified_at: nowIso,
      activo: true,
    })
    .eq('id', actorId)
    .eq('tenant_id', tenantId);
  if (verifyActorErr) return NextResponse.json({ error: verifyActorErr.message }, { status: 500 });

  await db
    .from('whatsapp_actor' as any)
    .update({
      activo: false,
      replaced_by_actor_id: actorId,
    })
    .eq('tenant_id', tenantId)
    .eq('usuario_id', actor.usuario_id)
    .eq('activo', true)
    .neq('id', actorId);

  const { data: verifiedActor } = await db
    .from('whatsapp_actor' as any)
    .select('from_wa_id')
    .eq('tenant_id', tenantId)
    .eq('id', actorId)
    .maybeSingle();

  const verifiedFromWaId = String(verifiedActor?.from_wa_id ?? '').trim();
  if (verifiedFromWaId) {
    try {
      await syncPlatformRoutingForVerifiedActor({
        db: createServiceRoleClient() as any,
        tenantId,
        fromWaId: verifiedFromWaId,
      });
    } catch (error) {
      console.error('[whatsapp][actors][verify_otp] platform routing sync error', {
        tenantId,
        actorId,
        error: (error as Error).message,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    actor_id: actorId,
    trust_level: 'verified',
    verified_at: nowIso,
  });
}

async function removeActorBinding(params: {
  tenantId: string;
  actorId: string;
  mode: RemoveWhatsAppActorMode;
}) {
  const adminDb = createServiceRoleClient() as any;
  try {
    const result = await removeWhatsAppActor({
      db: adminDb,
      tenantId: params.tenantId,
      actorId: params.actorId,
      mode: params.mode,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = (error as Error).message;
    const status = message.includes('no encontrada') ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: Request) {
  const guard = await moduloGuardAny([...MODULOS_ACCESO_LECTOR_FACTURAS, 'importador_excel']);
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectUnlessOwnerAdmin(session);
  if (forbidden) return forbidden;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const b = parseBodyAsRecord(body);
  const action = String(b.action ?? '').trim();
  const db = session.supabase as any;

  if (action === 'request_otp') {
    const userId = String(b.usuario_id ?? '').trim();
    const fromWaIdRaw = String(b.from_wa_id ?? '').trim();
    const actorRole = normalizeActorRole(b.rol_whatsapp);
    if (!userId || !fromWaIdRaw) {
      return NextResponse.json({ error: 'usuario_id y from_wa_id son obligatorios.' }, { status: 400 });
    }
    return requestOtp({
      db,
      tenantId: session.tenantId,
      userId,
      fromWaIdRaw,
      actorRole,
    });
  }

  if (action === 'verify_otp') {
    const actorId = String(b.actor_id ?? '').trim();
    const code = String(b.code ?? '').trim();
    if (!actorId || !code) {
      return NextResponse.json({ error: 'actor_id y code son obligatorios.' }, { status: 400 });
    }
    return verifyOtp({
      db,
      tenantId: session.tenantId,
      actorId,
      code,
    });
  }

  if (action === 'remove_actor') {
    const actorId = String(b.actor_id ?? '').trim();
    const modeRaw = String(b.mode ?? 'delete').trim().toLowerCase();
    const mode: RemoveWhatsAppActorMode = modeRaw === 'unlink' ? 'unlink' : 'delete';
    if (!actorId) {
      return NextResponse.json({ error: 'actor_id es obligatorio.' }, { status: 400 });
    }
    return removeActorBinding({
      tenantId: session.tenantId,
      actorId,
      mode,
    });
  }

  return NextResponse.json({ error: 'Acción inválida.' }, { status: 400 });
}
