-- v14.1 / V141-WA-004
-- Soporte de mensajes outbound tipo documento (PDF) en cola WhatsApp.

alter table public.whatsapp_outbound_message
  add column if not exists message_type text not null default 'text',
  add column if not exists document_link text,
  add column if not exists document_filename text,
  add column if not exists document_caption text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'whatsapp_outbound_message_type_check'
      and conrelid = 'public.whatsapp_outbound_message'::regclass
  ) then
    alter table public.whatsapp_outbound_message
      add constraint whatsapp_outbound_message_type_check
      check (message_type in ('text', 'document'));
  end if;
end $$;

create index if not exists idx_whatsapp_outbound_type_status
  on public.whatsapp_outbound_message(tenant_id, message_type, status, created_at);
