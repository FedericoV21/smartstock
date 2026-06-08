import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const fromWa = '5493816285231';

const { data: inbound } = await db
  .from('whatsapp_inbound_message')
  .select('id, tenant_id, text_body, created_at, to_phone_number_id')
  .eq('from_wa_id', fromWa)
  .order('created_at', { ascending: false })
  .limit(8);

console.log('=== INBOUND (recent) ===');
for (const row of inbound ?? []) {
  const { data: tenant } = await db.from('tenant').select('nombre').eq('id', row.tenant_id).maybeSingle();
  console.log(row.created_at, tenant?.nombre, row.text_body?.slice(0, 40));
}

const { data: outbound } = await db
  .from('whatsapp_outbound_message')
  .select('id, tenant_id, body, status, error_detail, created_at, sent_at')
  .eq('to_wa_id', fromWa)
  .order('created_at', { ascending: false })
  .limit(8);

console.log('\n=== OUTBOUND (recent) ===');
for (const row of outbound ?? []) {
  console.log(row.created_at, row.status, row.error_detail ?? '', String(row.body ?? '').slice(0, 60));
}

const { data: actors } = await db
  .from('whatsapp_actor')
  .select('id, tenant_id, trust_level, activo, verified_at')
  .eq('from_wa_id', fromWa)
  .eq('activo', true);

console.log('\n=== ACTORS ===', actors);

const { data: legacy } = await db
  .from('whatsapp_channel')
  .select('tenant_id, activa, phone_number_id')
  .eq('phone_number_id', '1130875700108533');

console.log('\n=== LEGACY CHANNEL ===', legacy);

const tenantId = '60556eb4-ca3c-49ad-aa7b-6456d04d2138';
const { data: flag } = await db
  .from('whatsapp_agent_feature_flag')
  .select('*')
  .eq('tenant_id', tenantId)
  .maybeSingle();

console.log('\n=== FEATURE FLAG ===', flag);
