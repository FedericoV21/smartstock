-- v2 WhatsApp agent
-- Cursor de paginacion conversacional para reportes.

alter table public.whatsapp_conversation_state
  add column if not exists last_report_key text,
  add column if not exists last_report_page integer;

alter table public.whatsapp_conversation_state
  drop constraint if exists whatsapp_conversation_state_last_report_page_check;

alter table public.whatsapp_conversation_state
  add constraint whatsapp_conversation_state_last_report_page_check
  check (last_report_page is null or last_report_page >= 1);
