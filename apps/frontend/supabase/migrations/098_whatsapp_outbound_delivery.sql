-- v10.0 / siguiente paso operativo WhatsApp
-- Entrega de mensajes salientes (outbound)

alter table public.whatsapp_outbound_message
  add column if not exists external_message_id text,
  add column if not exists retry_count integer not null default 0,
  add column if not exists last_error text,
  add column if not exists last_error_at timestamptz;

create index if not exists idx_whatsapp_outbound_retry
  on public.whatsapp_outbound_message(tenant_id, status, retry_count, created_at);
