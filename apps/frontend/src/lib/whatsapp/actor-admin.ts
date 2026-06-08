import { waIdLookupVariants } from '@/lib/whatsapp/otp';

type DbClient = any;

export type RemoveWhatsAppActorMode = 'unlink' | 'delete';

export async function removeWhatsAppActor(params: {
  db: DbClient;
  tenantId: string;
  actorId: string;
  mode: RemoveWhatsAppActorMode;
}): Promise<{ ok: true; mode: RemoveWhatsAppActorMode; actor_id: string }> {
  const { db, tenantId, actorId, mode } = params;

  const { data: actor, error: actorErr } = await db
    .from('whatsapp_actor' as any)
    .select('id, tenant_id, usuario_id, from_wa_id, trust_level, activo, verified_at')
    .eq('tenant_id', tenantId)
    .eq('id', actorId)
    .maybeSingle();
  if (actorErr) throw new Error(actorErr.message);
  if (!actor?.id) throw new Error('Vinculación no encontrada.');

  const fromWaId = String(actor.from_wa_id ?? '').trim();
  const trustLevel = String(actor.trust_level ?? 'unverified');

  await db
    .from('whatsapp_auth_challenge' as any)
    .update({ status: 'cancelled' })
    .eq('tenant_id', tenantId)
    .eq('actor_id', actorId)
    .in('status', ['pending', 'blocked']);

  if (mode === 'delete') {
    if (trustLevel === 'verified' && Boolean(actor.activo)) {
      throw new Error('No se puede eliminar una vinculación verificada activa. Desvinculala primero.');
    }

    const { error: deleteErr } = await db
      .from('whatsapp_actor' as any)
      .delete()
      .eq('tenant_id', tenantId)
      .eq('id', actorId);
    if (deleteErr) throw new Error(deleteErr.message);
  } else {
    const { error: updateErr } = await db
      .from('whatsapp_actor' as any)
      .update({
        activo: false,
        trust_level: 'unverified',
        verified_at: null,
      })
      .eq('tenant_id', tenantId)
      .eq('id', actorId);
    if (updateErr) throw new Error(updateErr.message);
  }

  if (fromWaId) {
    await clearPlatformRoutingForWaIdIfNeeded(db, fromWaId);
  }

  return { ok: true, mode, actor_id: actorId };
}

async function clearPlatformRoutingForWaIdIfNeeded(db: DbClient, fromWaId: string) {
  const lookupValues = waIdLookupVariants(fromWaId);
  const values = lookupValues.length > 0 ? lookupValues : [fromWaId];

  const { count, error: countErr } = await db
    .from('whatsapp_actor' as any)
    .select('id', { count: 'exact', head: true })
    .in('from_wa_id', values)
    .eq('activo', true)
    .eq('trust_level', 'verified');
  if (countErr) throw new Error(countErr.message);
  if ((count ?? 0) > 0) return;

  for (const waId of values) {
    await db.from('whatsapp_platform_routing_state' as any).delete().eq('from_wa_id', waId);
  }
}
