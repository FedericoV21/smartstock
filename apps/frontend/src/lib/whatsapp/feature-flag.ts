export type WhatsAppAgentFeatureFlag = {
  enabled: boolean;
  rolloutStage: string;
  notes: string | null;
};

function hashPercent(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) % 1000003;
  }
  return Math.abs(hash) % 100;
}

export function isWhatsAppV2EnabledForActor(flag: WhatsAppAgentFeatureFlag, actorKey: string): boolean {
  const stage = String(flag.rolloutStage ?? '').toLowerCase();
  if (!flag.enabled) return false;
  if (stage === 'v2' || stage === 'v2_all' || stage === 'v2_full') return true;
  if (stage === 'v1' || stage === 'stable' || stage === 'disabled') return false;

  const canaryMatch = stage.match(/^v2_canary_(\d{1,2}|100)$/);
  if (!canaryMatch) return false;
  const percent = Math.max(0, Math.min(100, Number(canaryMatch[1])));
  if (percent === 100) return true;
  return hashPercent(actorKey) < percent;
}

export async function getWhatsAppAgentFeatureFlag(db: any, tenantId: string): Promise<WhatsAppAgentFeatureFlag> {
  const { data, error } = await db
    .from('whatsapp_agent_feature_flag' as any)
    .select('enabled, rollout_stage, notes')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return {
      enabled: false,
      rolloutStage: 'disabled',
      notes: null,
    };
  }

  return {
    enabled: Boolean(data.enabled),
    rolloutStage: String(data.rollout_stage ?? 'disabled'),
    notes: data.notes ? String(data.notes) : null,
  };
}
