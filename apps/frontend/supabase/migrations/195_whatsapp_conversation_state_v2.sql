-- v14.4 / V144-WA-007
-- Memoria conversacional v2: resumen de turno + sesión larga.

alter table public.whatsapp_conversation_state
  add column if not exists last_user_message text,
  add column if not exists last_bot_summary text,
  add column if not exists last_contact_field text,
  add column if not exists turn_count integer not null default 0,
  add column if not exists session_started_at timestamptz;

alter table public.whatsapp_conversation_state
  drop constraint if exists whatsapp_conversation_state_turn_count_check;

alter table public.whatsapp_conversation_state
  add constraint whatsapp_conversation_state_turn_count_check
  check (turn_count >= 0);

comment on column public.whatsapp_conversation_state.expires_at is
  'TTL corto de slots de follow-up (topic, intent, entidad). Ver WHATSAPP_CONVERSATION_TTL_MINUTES.';

comment on column public.whatsapp_conversation_state.session_started_at is
  'Inicio de sesión larga (saludo/bienvenida). Ver WHATSAPP_CONVERSATION_SESSION_HOURS.';
