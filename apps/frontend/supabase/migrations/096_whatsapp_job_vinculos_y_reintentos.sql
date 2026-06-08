-- v10.0 / V100-WA-003
-- Vinculos de jobs a entidades destino + reintentos

alter table public.whatsapp_processing_job
  add column if not exists target_entity_type text,
  add column if not exists target_entity_id uuid,
  add column if not exists retry_count integer not null default 0,
  add column if not exists last_error_at timestamptz;

create index if not exists idx_whatsapp_job_target
  on public.whatsapp_processing_job(tenant_id, target_entity_type, target_entity_id);
