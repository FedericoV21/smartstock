import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { createHmac } from 'node:crypto';

const port = process.env.WA_TEST_PORT || '3000';
const baseUrl = `http://localhost:${port}`;
const fromWa = '5493816285231';
const phoneNumberId = '1130875700108533';

const payload = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '2794073347616281',
      changes: [
        {
          value: {
            messaging_product: 'whatsapp',
            metadata: {
              display_phone_number: '5491130875700',
              phone_number_id: phoneNumberId,
            },
            contacts: [{ profile: { name: 'Fede Valle' }, wa_id: fromWa }],
            messages: [
              {
                from: fromWa,
                id: `wamid.test.${Date.now()}`,
                timestamp: String(Math.floor(Date.now() / 1000)),
                text: { body: 'buenas que stock tengo' },
                type: 'text',
              },
            ],
          },
          field: 'messages',
        },
      ],
    },
  ],
};

const rawBody = JSON.stringify(payload);
const secret = (process.env.WHATSAPP_WEBHOOK_APP_SECRET ?? '').trim();
const headers = { 'Content-Type': 'application/json' };
if (secret) {
  const sig = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  headers['x-hub-signature-256'] = `sha256=${sig}`;
}

const res = await fetch(`${baseUrl}/api/whatsapp/webhook`, {
  method: 'POST',
  headers,
  body: rawBody,
});
console.log('Webhook status:', res.status, await res.text());

await new Promise((r) => setTimeout(r, 3000));

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data: inbound } = await db
  .from('whatsapp_inbound_message')
  .select('id, tenant_id, text_body, created_at')
  .eq('from_wa_id', fromWa)
  .order('created_at', { ascending: false })
  .limit(2);

console.log('Latest inbound:', inbound);

const { data: outbound } = await db
  .from('whatsapp_outbound_message')
  .select('id, tenant_id, body, status, error_detail, created_at')
  .eq('to_wa_id', fromWa)
  .order('created_at', { ascending: false })
  .limit(3);

console.log('Latest outbound:', outbound?.map((r) => ({ status: r.status, body: String(r.body).slice(0, 80), error: r.error_detail })));
