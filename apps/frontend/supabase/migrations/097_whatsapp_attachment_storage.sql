-- v10.0 / siguiente paso operativo WhatsApp
-- Guardado de adjuntos descargados desde Meta Cloud API

alter table public.whatsapp_inbound_attachment
  add column if not exists storage_bucket text,
  add column if not exists storage_path text,
  add column if not exists archivo_tamano bigint,
  add column if not exists download_status text not null default 'pending',
  add column if not exists downloaded_at timestamptz,
  add column if not exists download_error text;

create index if not exists idx_whatsapp_attachment_download_status
  on public.whatsapp_inbound_attachment(tenant_id, download_status, created_at);
