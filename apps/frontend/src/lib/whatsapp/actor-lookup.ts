import { canonicalWaId, waIdLookupVariants, waIdsMatch } from '@/lib/whatsapp/otp';

export type WhatsAppActorRow = {
  id: string;
  tenant_id?: string;
  usuario_id?: string;
  trust_level: string;
  rol_whatsapp?: string | null;
  activo?: boolean;
  from_wa_id: string;
  verified_at?: string | null;
};

function pickPreferredActor(rows: WhatsAppActorRow[]): WhatsAppActorRow | null {
  if (rows.length === 0) return null;
  return (
    rows.find((row) => String(row.trust_level) === 'verified') ??
    rows.find((row) => String(row.trust_level) !== 'blocked') ??
    rows[0] ??
    null
  );
}

export async function findActiveWhatsAppActors(params: {
  db: any;
  fromWaId: string;
  tenantId?: string;
  limit?: number;
}): Promise<WhatsAppActorRow[]> {
  const lookupValues = waIdLookupVariants(params.fromWaId);
  const select =
    'id, tenant_id, usuario_id, trust_level, rol_whatsapp, activo, from_wa_id, verified_at, tenant:tenant_id(nombre)';

  let primaryQuery = params.db.from('whatsapp_actor' as any).select(select).eq('activo', true);
  if (params.tenantId) primaryQuery = primaryQuery.eq('tenant_id', params.tenantId);
  if (lookupValues.length > 0) {
    primaryQuery = primaryQuery.in('from_wa_id', lookupValues);
  }

  const { data: primaryRows, error: primaryErr } = await primaryQuery.limit(params.limit ?? 10);
  if (primaryErr) throw new Error(primaryErr.message);
  if ((primaryRows ?? []).length > 0) {
    return primaryRows as WhatsAppActorRow[];
  }

  let fallbackQuery = params.db.from('whatsapp_actor' as any).select(select).eq('activo', true);
  if (params.tenantId) fallbackQuery = fallbackQuery.eq('tenant_id', params.tenantId);
  const { data: fallbackRows, error: fallbackErr } = await fallbackQuery.limit(50);
  if (fallbackErr) throw new Error(fallbackErr.message);

  return ((fallbackRows ?? []) as WhatsAppActorRow[]).filter((row) =>
    waIdsMatch(String(row.from_wa_id ?? ''), params.fromWaId),
  );
}

export async function findPreferredWhatsAppActor(params: {
  db: any;
  fromWaId: string;
  tenantId?: string;
}): Promise<WhatsAppActorRow | null> {
  const rows = await findActiveWhatsAppActors(params);
  return pickPreferredActor(rows);
}

export async function findWhatsAppActorById(params: {
  db: any;
  tenantId: string;
  actorId: string;
}): Promise<WhatsAppActorRow | null> {
  const { data, error } = await params.db
    .from('whatsapp_actor' as any)
    .select('id, tenant_id, usuario_id, trust_level, rol_whatsapp, activo, from_wa_id, verified_at')
    .eq('id', params.actorId)
    .eq('tenant_id', params.tenantId)
    .eq('activo', true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as WhatsAppActorRow | null) ?? null;
}

export async function reconcileWhatsAppActorWaId(params: {
  db: any;
  tenantId: string;
  actorId: string;
  inboundFromWaId: string;
}): Promise<void> {
  const canonical = canonicalWaId(params.inboundFromWaId);
  if (!canonical) return;

  const { error } = await params.db
    .from('whatsapp_actor' as any)
    .update({ from_wa_id: canonical })
    .eq('tenant_id', params.tenantId)
    .eq('id', params.actorId)
    .neq('from_wa_id', canonical);
  if (error) throw new Error(error.message);
}

export async function syncPlatformRoutingForVerifiedActor(params: {
  db: any;
  tenantId: string;
  fromWaId: string;
}): Promise<void> {
  const lookupKeys = waIdLookupVariants(params.fromWaId);
  const keys = lookupKeys.length > 0 ? lookupKeys : [params.fromWaId];
  const canonical = canonicalWaId(params.fromWaId) ?? params.fromWaId;
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString();

  for (const key of keys) {
    await params.db.from('whatsapp_platform_routing_state' as any).delete().eq('from_wa_id', key);
  }

  await params.db.from('whatsapp_platform_routing_state' as any).upsert(
    {
      from_wa_id: canonical,
      selected_tenant_id: params.tenantId,
      pending_choices: [],
      expires_at: expiresAt,
    },
    { onConflict: 'from_wa_id' },
  );
}
