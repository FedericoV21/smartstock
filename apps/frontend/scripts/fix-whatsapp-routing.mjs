import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const phone = '1130875700108533';
const fromWa = '5493816285231';
const tenantCorrect = '60556eb4-ca3c-49ad-aa7b-6456d04d2138';

const { data: legacy } = await db.from('whatsapp_channel').select('id, tenant_id, activa').eq('phone_number_id', phone);
console.log('Legacy channels:', legacy);

const { error: deactErr } = await db
  .from('whatsapp_channel')
  .update({ activa: false })
  .eq('phone_number_id', phone)
  .eq('activa', true);
console.log('Deactivate legacy:', deactErr?.message ?? 'ok');

const { data: flagBefore } = await db
  .from('whatsapp_agent_feature_flag')
  .select('*')
  .eq('tenant_id', tenantCorrect)
  .maybeSingle();
console.log('Feature flag before:', flagBefore);

const { error: flagErr } = await db.from('whatsapp_agent_feature_flag').upsert(
  {
    tenant_id: tenantCorrect,
    enabled: true,
    rollout_stage: 'pilot',
    notes: 'auto-enabled for WhatsApp routing fix',
  },
  { onConflict: 'tenant_id' },
);
console.log('Enable feature flag:', flagErr?.message ?? 'ok');

const { data: actors } = await db
  .from('whatsapp_actor')
  .select('id, tenant_id, from_wa_id, trust_level, activo, verified_at')
  .eq('from_wa_id', fromWa)
  .eq('activo', true);
console.log('Actors for', fromWa, ':', actors);

const { data: inbound } = await db
  .from('whatsapp_inbound_message')
  .select('id, tenant_id, from_wa_id, text_body, created_at')
  .eq('from_wa_id', fromWa)
  .order('created_at', { ascending: false })
  .limit(3);
console.log('Recent inbound:', inbound);
