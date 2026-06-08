import { NextResponse } from 'next/server';

import { getTenantSession } from '@/lib/api/tenant-session';
import { moduloGuardAny } from '@/lib/modulos/guard';
import { MODULOS_ACCESO_LECTOR_FACTURAS } from '@/lib/modulos/modulo-key';
import { createServiceRoleClient } from '@/lib/supabase/server';
import {
  getWhatsAppPlatformChannel,
  getWhatsAppPlatformPhoneNumberIdFromEnv,
  normalizeWhatsAppPhoneNumberId,
} from '@/lib/whatsapp/platform-channel';

function rejectUnlessPlatformManager(session: { rol: string; isSuperAdmin: boolean }) {
  if (session.isSuperAdmin) return null;
  return NextResponse.json(
    { error: 'Solo super admin puede configurar el canal WhatsApp central de SmartStock.' },
    { status: 403 },
  );
}

export async function GET() {
  const guard = await moduloGuardAny([...MODULOS_ACCESO_LECTOR_FACTURAS, 'importador_excel']);
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const db = createServiceRoleClient() as any;
  const platformChannel = await getWhatsAppPlatformChannel(db);
  const envPhoneNumberId = getWhatsAppPlatformPhoneNumberIdFromEnv();

  const { count: linkedVerifiedActors, error: actorsErr } = await db
    .from('whatsapp_actor' as any)
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', session.tenantId)
    .eq('activo', true)
    .eq('trust_level', 'verified');
  if (actorsErr) return NextResponse.json({ error: actorsErr.message }, { status: 500 });

  return NextResponse.json({
    mode: 'platform',
    channel_id: platformChannel?.id ?? null,
    phone_number_id: platformChannel?.phoneNumberId ?? null,
    activa: Boolean(platformChannel?.activa),
    has_channel: Boolean(platformChannel?.phoneNumberId),
    configured_via_env: Boolean(envPhoneNumberId),
    can_manage_platform: session.isSuperAdmin,
    linked_verified_actors: linkedVerifiedActors ?? 0,
  });
}

export async function PATCH(request: Request) {
  const guard = await moduloGuardAny([...MODULOS_ACCESO_LECTOR_FACTURAS, 'importador_excel']);
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectUnlessPlatformManager(session);
  if (forbidden) return forbidden;

  if (getWhatsAppPlatformPhoneNumberIdFromEnv()) {
    return NextResponse.json(
      {
        error:
          'El canal central esta fijado por WHATSAPP_PLATFORM_PHONE_NUMBER_ID en el entorno. Quita esa variable para editarlo desde la UI.',
      },
      { status: 409 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 });
  }

  const payload =
    body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const phoneNumberId = normalizeWhatsAppPhoneNumberId(payload.phone_number_id);
  const activa = payload.activa === undefined ? true : Boolean(payload.activa);

  if (activa && !phoneNumberId) {
    return NextResponse.json(
      { error: 'Para activar el canal central, indicá un Phone Number ID válido.' },
      { status: 400 },
    );
  }

  const db = createServiceRoleClient() as any;

  if (!activa) {
    const { error } = await db
      .from('whatsapp_platform_channel' as any)
      .update({ activa: false })
      .eq('phone_number_id', phoneNumberId || '')
      .neq('phone_number_id', '');

    if (error && phoneNumberId) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (!phoneNumberId) {
      const { error: deactivateAllErr } = await db
        .from('whatsapp_platform_channel' as any)
        .update({ activa: false })
        .eq('activa', true);
      if (deactivateAllErr) {
        return NextResponse.json({ error: deactivateAllErr.message }, { status: 400 });
      }
    }

    return NextResponse.json({
      ok: true,
      mode: 'platform',
      channel_id: null,
      phone_number_id: phoneNumberId || null,
      activa: false,
    });
  }

  const { data: upserted, error: upsertErr } = await db
    .from('whatsapp_platform_channel' as any)
    .upsert(
      {
        phone_number_id: phoneNumberId,
        activa: true,
      },
      { onConflict: 'phone_number_id' },
    )
    .select('id, phone_number_id, activa')
    .single();
  if (upsertErr) return NextResponse.json({ error: upsertErr.message }, { status: 400 });

  const { error: deactivateOthersErr } = await db
    .from('whatsapp_platform_channel' as any)
    .update({ activa: false })
    .neq('phone_number_id', phoneNumberId);
  if (deactivateOthersErr) {
    return NextResponse.json({ error: deactivateOthersErr.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    mode: 'platform',
    channel_id: upserted?.id ?? null,
    phone_number_id: upserted?.phone_number_id ?? phoneNumberId,
    activa: Boolean(upserted?.activa),
  });
}
