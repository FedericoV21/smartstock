import { findActiveWhatsAppActors } from '@/lib/whatsapp/actor-lookup';
import { waIdLookupVariants } from '@/lib/whatsapp/otp';
import {
  getWhatsAppPlatformPhoneNumberId,
  isWhatsAppPlatformPhoneNumberId,
} from '@/lib/whatsapp/platform-channel';
import { sendWhatsAppTextMessage } from '@/lib/whatsapp/send-message';

export type WhatsAppTenantChoice = {
  tenantId: string;
  tenantName: string;
  actorId: string;
  trustLevel: string;
};

export type WhatsAppInboundTenantResolution =
  | {
      mode: 'platform';
      tenantId: string;
      actorId: string | null;
      trustLevel: string | null;
    }
  | {
      mode: 'legacy_channel';
      tenantId: string;
    }
  | {
      mode: 'unroutable';
      reason: 'platform_inactive' | 'unknown_phone_number_id' | 'no_actor' | 'pending_tenant_selection';
      handled: boolean;
    };

type RoutingStateRow = {
  from_wa_id: string;
  selected_tenant_id: string | null;
  pending_choices: unknown;
  expires_at: string;
};

type ActorRow = {
  id: string;
  tenant_id: string;
  trust_level: string;
  from_wa_id: string;
  tenant?: { nombre?: string | null } | Array<{ nombre?: string | null }> | null;
};

const SELECTED_TENANT_TTL_DAYS = 30;
const PENDING_SELECTION_TTL_MINUTES = 30;

function pickTenantName(row: ActorRow): string {
  const tenant = Array.isArray(row.tenant) ? row.tenant[0] : row.tenant;
  const name = String(tenant?.nombre ?? '').trim();
  return name || 'Negocio sin nombre';
}

function trustRank(value: string): number {
  if (value === 'verified') return 0;
  if (value === 'unverified') return 1;
  if (value === 'blocked') return 2;
  return 3;
}

function parseTenantChoices(raw: unknown): WhatsAppTenantChoice[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      const tenantId = String(row.tenantId ?? row.tenant_id ?? '').trim();
      const tenantName = String(row.tenantName ?? row.tenant_name ?? '').trim();
      const actorId = String(row.actorId ?? row.actor_id ?? '').trim();
      const trustLevel = String(row.trustLevel ?? row.trust_level ?? 'unverified').trim();
      if (!tenantId || !tenantName || !actorId) return null;
      return { tenantId, tenantName, actorId, trustLevel };
    })
    .filter((item): item is WhatsAppTenantChoice => item != null);
}

export function parseTenantSelectionReply(
  text: string,
  choices: WhatsAppTenantChoice[],
): WhatsAppTenantChoice | null {
  const trimmed = text.trim();
  if (!trimmed || choices.length === 0) return null;

  const numeric = Number(trimmed.replace(/[^\d]/g, ''));
  if (Number.isFinite(numeric) && numeric >= 1 && numeric <= choices.length) {
    return choices[numeric - 1] ?? null;
  }

  const lower = trimmed.toLowerCase();
  const exact = choices.find((choice) => choice.tenantName.toLowerCase() === lower);
  if (exact) return exact;

  const partialMatches = choices.filter((choice) => {
    const name = choice.tenantName.toLowerCase();
    return name.includes(lower) || lower.includes(name);
  });
  if (partialMatches.length === 1) return partialMatches[0] ?? null;

  return null;
}

function buildTenantSelectionPrompt(choices: WhatsAppTenantChoice[]): string {
  const lines = choices.map((choice, index) => `${index + 1}. ${choice.tenantName}`);
  return [
    'Tu numero esta vinculado a mas de un negocio en SmartStock.',
    'Responde con el numero del negocio con el que queres operar:',
    ...lines,
  ].join('\n');
}

function unknownSenderPrompt(): string {
  return [
    'Hola. Este es el canal de consultas de SmartStock.',
    'Tu numero todavia no esta vinculado a ningun negocio.',
    'Pedile al administrador de tu comercio que registre tu WhatsApp en la bandeja de WhatsApp del sistema y complete la verificacion por codigo OTP.',
  ].join('\n');
}

async function sendDirectPlatformReply(params: {
  phoneNumberId: string;
  toWaId: string;
  body: string;
}) {
  try {
    await sendWhatsAppTextMessage({
      phoneNumberId: params.phoneNumberId,
      toWaId: params.toWaId,
      body: params.body,
    });
    return true;
  } catch (error) {
    console.error('[whatsapp][inbound-routing] direct reply failed', {
      toWaId: params.toWaId,
      error: (error as Error).message,
    });
    return false;
  }
}

async function loadRoutingState(db: any, fromWaId: string): Promise<RoutingStateRow | null> {
  const keys = waIdLookupVariants(fromWaId);
  const lookupKeys = keys.length > 0 ? keys : [fromWaId];

  for (const key of lookupKeys) {
    const { data, error } = await db
      .from('whatsapp_platform_routing_state' as any)
      .select('from_wa_id, selected_tenant_id, pending_choices, expires_at')
      .eq('from_wa_id', key)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data?.from_wa_id) continue;
    if (new Date(String(data.expires_at)).getTime() < Date.now()) {
      await db.from('whatsapp_platform_routing_state' as any).delete().eq('from_wa_id', key);
      continue;
    }
    return data as RoutingStateRow;
  }

  return null;
}

async function saveSelectedTenant(db: any, fromWaId: string, tenantId: string) {
  const expiresAt = new Date(Date.now() + SELECTED_TENANT_TTL_DAYS * 24 * 60 * 60_000).toISOString();
  const { error } = await db.from('whatsapp_platform_routing_state' as any).upsert(
    {
      from_wa_id: fromWaId,
      selected_tenant_id: tenantId,
      pending_choices: [],
      expires_at: expiresAt,
    },
    { onConflict: 'from_wa_id' },
  );
  if (error) throw new Error(error.message);
}

async function savePendingTenantChoices(db: any, fromWaId: string, choices: WhatsAppTenantChoice[]) {
  const expiresAt = new Date(Date.now() + PENDING_SELECTION_TTL_MINUTES * 60_000).toISOString();
  const { error } = await db.from('whatsapp_platform_routing_state' as any).upsert(
    {
      from_wa_id: fromWaId,
      selected_tenant_id: null,
      pending_choices: choices,
      expires_at: expiresAt,
    },
    { onConflict: 'from_wa_id' },
  );
  if (error) throw new Error(error.message);
}

async function clearPendingTenantChoices(db: any, fromWaId: string) {
  const { error } = await db
    .from('whatsapp_platform_routing_state' as any)
    .update({ pending_choices: [] })
    .eq('from_wa_id', fromWaId);
  if (error) throw new Error(error.message);
}

async function loadActorsForSender(db: any, fromWaId: string): Promise<ActorRow[]> {
  const rows = await findActiveWhatsAppActors({ db, fromWaId, limit: 20 });

  const byTenant = new Map<string, ActorRow>();
  for (const row of rows) {
    if (String(row.trust_level) === 'blocked') continue;
    const tenantId = String(row.tenant_id ?? '');
    if (!tenantId) continue;
    const existing = byTenant.get(tenantId);
    if (!existing || trustRank(String(row.trust_level)) < trustRank(String(existing.trust_level))) {
      byTenant.set(tenantId, row as ActorRow);
    }
  }

  return Array.from(byTenant.values()).sort(
    (a, b) => trustRank(String(a.trust_level)) - trustRank(String(b.trust_level)),
  );
}

function actorChoices(rows: ActorRow[]): WhatsAppTenantChoice[] {
  return rows.map((row) => ({
    tenantId: String(row.tenant_id),
    tenantName: pickTenantName(row),
    actorId: String(row.id),
    trustLevel: String(row.trust_level ?? 'unverified'),
  }));
}

async function resolveLegacyDedicatedChannelTenant(
  db: any,
  phoneNumberId: string,
  platformPhoneNumberId: string | null,
): Promise<string | null> {
  if (isWhatsAppPlatformPhoneNumberId(phoneNumberId, platformPhoneNumberId)) {
    return null;
  }

  const { data, error } = await db
    .from('whatsapp_channel' as any)
    .select('tenant_id')
    .eq('phone_number_id', phoneNumberId)
    .eq('activa', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const tenantId = String(data?.tenant_id ?? '').trim();
  return tenantId || null;
}

async function resolvePlatformTenant(params: {
  db: any;
  fromWaId: string;
  phoneNumberId: string;
  textBody?: string | null;
}): Promise<WhatsAppInboundTenantResolution> {
  const { db, fromWaId, phoneNumberId, textBody } = params;
  const actors = await loadActorsForSender(db, fromWaId);

  const routingState = await loadRoutingState(db, fromWaId);
  const pendingChoices = parseTenantChoices(routingState?.pending_choices);

  if (pendingChoices.length > 0 && textBody) {
    const selected = parseTenantSelectionReply(textBody, pendingChoices);
    if (selected) {
      await saveSelectedTenant(db, fromWaId, selected.tenantId);
      return {
        mode: 'platform',
        tenantId: selected.tenantId,
        actorId: selected.actorId,
        trustLevel: selected.trustLevel,
      };
    }

    await sendDirectPlatformReply({
      phoneNumberId,
      toWaId: fromWaId,
      body: buildTenantSelectionPrompt(pendingChoices),
    });
    return {
      mode: 'unroutable',
      reason: 'pending_tenant_selection',
      handled: true,
    };
  }

  const verifiedActors = actors.filter((row) => String(row.trust_level) === 'verified');
  if (verifiedActors.length === 1) {
    const only = verifiedActors[0];
    await saveSelectedTenant(db, fromWaId, String(only.tenant_id));
    return {
      mode: 'platform',
      tenantId: String(only.tenant_id),
      actorId: String(only.id),
      trustLevel: String(only.trust_level ?? null),
    };
  }

  if (verifiedActors.length > 1) {
    const choices = actorChoices(verifiedActors);
    await savePendingTenantChoices(db, fromWaId, choices);
    await sendDirectPlatformReply({
      phoneNumberId,
      toWaId: fromWaId,
      body: buildTenantSelectionPrompt(choices),
    });
    return {
      mode: 'unroutable',
      reason: 'pending_tenant_selection',
      handled: true,
    };
  }

  if (routingState?.selected_tenant_id) {
    const selectedActor = actors.find(
      (row) => String(row.tenant_id) === String(routingState.selected_tenant_id),
    );
    if (selectedActor && String(selectedActor.trust_level) === 'verified') {
      await clearPendingTenantChoices(db, fromWaId);
      return {
        mode: 'platform',
        tenantId: String(selectedActor.tenant_id),
        actorId: String(selectedActor.id),
        trustLevel: String(selectedActor.trust_level ?? null),
      };
    }
  }

  if (actors.length === 0) {
    await sendDirectPlatformReply({
      phoneNumberId,
      toWaId: fromWaId,
      body: unknownSenderPrompt(),
    });
    return {
      mode: 'unroutable',
      reason: 'no_actor',
      handled: true,
    };
  }

  const choices = actorChoices(actors);
  if (choices.length === 1) {
    const only = choices[0];
    await saveSelectedTenant(db, fromWaId, only.tenantId);
    return {
      mode: 'platform',
      tenantId: only.tenantId,
      actorId: only.actorId,
      trustLevel: only.trustLevel,
    };
  }

  await savePendingTenantChoices(db, fromWaId, choices);
  await sendDirectPlatformReply({
    phoneNumberId,
    toWaId: fromWaId,
    body: buildTenantSelectionPrompt(choices),
  });
  return {
    mode: 'unroutable',
    reason: 'pending_tenant_selection',
    handled: true,
  };
}

async function resolveSingleVerifiedActorTenant(params: {
  db: any;
  fromWaId: string;
}): Promise<WhatsAppInboundTenantResolution | null> {
  const verifiedActors = (
    await findActiveWhatsAppActors({
      db: params.db,
      fromWaId: params.fromWaId,
      limit: 20,
    })
  ).filter((row) => String(row.trust_level) === 'verified');

  if (verifiedActors.length !== 1) return null;

  const actor = verifiedActors[0];
  return {
    mode: 'platform',
    tenantId: String(actor.tenant_id),
    actorId: String(actor.id),
    trustLevel: String(actor.trust_level ?? null),
  };
}

export async function resolveInboundWhatsAppTenant(params: {
  db: any;
  phoneNumberId: string;
  fromWaId: string;
  textBody?: string | null;
}): Promise<WhatsAppInboundTenantResolution> {
  const platformPhoneNumberId = await getWhatsAppPlatformPhoneNumberId(params.db);

  const verifiedTenant = await resolveSingleVerifiedActorTenant({
    db: params.db,
    fromWaId: params.fromWaId,
  });
  if (verifiedTenant) {
    return verifiedTenant;
  }

  if (isWhatsAppPlatformPhoneNumberId(params.phoneNumberId, platformPhoneNumberId)) {
    return resolvePlatformTenant({
      db: params.db,
      fromWaId: params.fromWaId,
      phoneNumberId: params.phoneNumberId,
      textBody: params.textBody,
    });
  }

  const legacyTenantId = await resolveLegacyDedicatedChannelTenant(
    params.db,
    params.phoneNumberId,
    platformPhoneNumberId,
  );
  if (legacyTenantId) {
    return {
      mode: 'legacy_channel',
      tenantId: legacyTenantId,
    };
  }

  if (!platformPhoneNumberId) {
    return {
      mode: 'unroutable',
      reason: 'platform_inactive',
      handled: false,
    };
  }

  return {
    mode: 'unroutable',
    reason: 'unknown_phone_number_id',
    handled: false,
  };
}
