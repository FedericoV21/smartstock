import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-WA-001 Phase A: WhatsApp foundation schema (no RLS).
 * Paridad Supabase 094–098, 156–158, 183, 186.
 */
export class NbWa001WhatsappSchema1750090000000 implements MigrationInterface {
  name = 'NbWa001WhatsappSchema1750090000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE public.modulo_config
  ADD COLUMN IF NOT EXISTS lector_facturas BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'whatsapp_job_status' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.whatsapp_job_status AS ENUM (
      'queued',
      'processing',
      'imported',
      'review_required',
      'error',
      'awaiting_branch_confirmation'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'whatsapp_branch_resolution_status' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.whatsapp_branch_resolution_status AS ENUM (
      'resolved_auto',
      'resolved_manual',
      'ambiguous',
      'not_found'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'whatsapp_actor_trust_level' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.whatsapp_actor_trust_level AS ENUM (
      'verified',
      'unverified',
      'blocked'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'whatsapp_auth_challenge_status' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.whatsapp_auth_challenge_status AS ENUM (
      'pending',
      'verified',
      'expired',
      'blocked',
      'cancelled'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'whatsapp_action_status' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.whatsapp_action_status AS ENUM (
      'pending_confirmation',
      'executed',
      'cancelled',
      'error'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.whatsapp_channel (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  phone_number_id TEXT NOT NULL,
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.whatsapp_inbound_message (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  wamid TEXT NOT NULL,
  from_wa_id TEXT NOT NULL,
  to_phone_number_id TEXT,
  message_type TEXT NOT NULL,
  text_body TEXT,
  metadata JSONB,
  raw_payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_whatsapp_inbound_wamid UNIQUE (wamid)
);

CREATE TABLE IF NOT EXISTS public.whatsapp_inbound_attachment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  inbound_message_id UUID NOT NULL REFERENCES public.whatsapp_inbound_message(id) ON DELETE CASCADE,
  wa_media_id TEXT,
  mime_type TEXT,
  filename TEXT,
  sha256 TEXT NOT NULL,
  raw_payload JSONB,
  storage_bucket TEXT,
  storage_path TEXT,
  archivo_tamano BIGINT,
  download_status TEXT NOT NULL DEFAULT 'pending',
  downloaded_at TIMESTAMPTZ,
  download_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_whatsapp_attachment_message_sha UNIQUE (inbound_message_id, sha256)
);

CREATE TABLE IF NOT EXISTS public.whatsapp_processing_job (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  inbound_message_id UUID NOT NULL REFERENCES public.whatsapp_inbound_message(id) ON DELETE CASCADE,
  inbound_attachment_id UUID REFERENCES public.whatsapp_inbound_attachment(id) ON DELETE CASCADE,
  status public.whatsapp_job_status NOT NULL DEFAULT 'queued',
  document_type TEXT,
  error_code TEXT,
  error_detail TEXT,
  from_wa_id TEXT,
  to_phone_number_id TEXT,
  branch_id UUID REFERENCES public.sucursal(id) ON DELETE SET NULL,
  branch_resolution_status public.whatsapp_branch_resolution_status,
  branch_resolution_reason TEXT,
  branch_prompt_requested_at TIMESTAMPTZ,
  branch_prompt_deadline_at TIMESTAMPTZ,
  target_entity_type TEXT,
  target_entity_id UUID,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.whatsapp_job_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.whatsapp_processing_job(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.whatsapp_branch_rule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  from_wa_id TEXT,
  phone_number_id TEXT,
  proveedor_id UUID REFERENCES public.proveedor(id) ON DELETE SET NULL,
  sucursal_id UUID NOT NULL REFERENCES public.sucursal(id) ON DELETE CASCADE,
  prioridad INTEGER NOT NULL DEFAULT 0,
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.whatsapp_outbound_message (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  to_wa_id TEXT NOT NULL,
  phone_number_id TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  related_job_id UUID REFERENCES public.whatsapp_processing_job(id) ON DELETE SET NULL,
  external_message_id TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_error_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.whatsapp_actor (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL REFERENCES public.usuario(id) ON DELETE CASCADE,
  from_wa_id TEXT NOT NULL,
  rol_whatsapp TEXT NOT NULL DEFAULT 'operador',
  trust_level public.whatsapp_actor_trust_level NOT NULL DEFAULT 'unverified',
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  verified_at TIMESTAMPTZ,
  replaced_by_actor_id UUID REFERENCES public.whatsapp_actor(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_whatsapp_actor_verified_at CHECK (
    (trust_level = 'verified' AND verified_at IS NOT NULL)
    OR (trust_level <> 'verified')
  )
);

CREATE TABLE IF NOT EXISTS public.whatsapp_auth_challenge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES public.whatsapp_actor(id) ON DELETE CASCADE,
  channel_phone_number_id TEXT,
  otp_hash TEXT NOT NULL,
  otp_salt TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  resend_count INTEGER NOT NULL DEFAULT 0,
  blocked_until TIMESTAMPTZ,
  status public.whatsapp_auth_challenge_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at TIMESTAMPTZ,
  CONSTRAINT chk_whatsapp_auth_challenge_attempt_count CHECK (attempt_count >= 0),
  CONSTRAINT chk_whatsapp_auth_challenge_max_attempts CHECK (max_attempts > 0),
  CONSTRAINT chk_whatsapp_auth_challenge_resend_count CHECK (resend_count >= 0),
  CONSTRAINT chk_whatsapp_auth_challenge_verified_at CHECK (
    (status = 'verified' AND verified_at IS NOT NULL)
    OR (status <> 'verified')
  )
);

CREATE TABLE IF NOT EXISTS public.whatsapp_action_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES public.whatsapp_actor(id) ON DELETE CASCADE,
  inbound_message_id UUID REFERENCES public.whatsapp_inbound_message(id) ON DELETE SET NULL,
  from_wa_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  action_status public.whatsapp_action_status NOT NULL DEFAULT 'pending_confirmation',
  action_signature TEXT NOT NULL,
  confirmation_token TEXT,
  confirmation_expires_at TIMESTAMPTZ,
  action_payload JSONB NOT NULL,
  result_payload JSONB,
  error_detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  CONSTRAINT uq_whatsapp_action_signature UNIQUE (tenant_id, action_signature)
);

CREATE TABLE IF NOT EXISTS public.whatsapp_agent_feature_flag (
  tenant_id UUID PRIMARY KEY REFERENCES public.tenant(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  rollout_stage TEXT NOT NULL DEFAULT 'disabled',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.whatsapp_platform_channel (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number_id TEXT NOT NULL,
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_whatsapp_platform_channel_phone UNIQUE (phone_number_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_platform_channel_one_active
  ON public.whatsapp_platform_channel ((activa))
  WHERE activa = TRUE;

CREATE TABLE IF NOT EXISTS public.whatsapp_platform_routing_state (
  from_wa_id TEXT PRIMARY KEY,
  selected_tenant_id UUID REFERENCES public.tenant(id) ON DELETE SET NULL,
  pending_choices JSONB NOT NULL DEFAULT '[]'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.whatsapp_agent_turn_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES public.whatsapp_actor(id) ON DELETE SET NULL,
  usuario_id UUID REFERENCES public.usuario(id) ON DELETE SET NULL,
  inbound_message_id UUID REFERENCES public.whatsapp_inbound_message(id) ON DELETE SET NULL,
  action_log_id UUID REFERENCES public.whatsapp_action_log(id) ON DELETE SET NULL,
  from_wa_id TEXT,
  channel TEXT NOT NULL,
  source TEXT NOT NULL,
  input_body TEXT NOT NULL,
  resolved_message TEXT,
  reply_body TEXT,
  replies JSONB NOT NULL DEFAULT '[]'::jsonb,
  intent TEXT,
  confidence NUMERIC,
  fallback_reason TEXT,
  status TEXT NOT NULL,
  tool_name TEXT,
  tool_args JSONB,
  tool_result JSONB,
  tool_trace JSONB,
  processing_trace JSONB NOT NULL DEFAULT '{}'::jsonb,
  duration_ms INTEGER,
  error_detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '90 days'),
  CONSTRAINT whatsapp_agent_turn_log_channel_check CHECK (channel IN ('live', 'sandbox')),
  CONSTRAINT whatsapp_agent_turn_log_status_check CHECK (status IN ('success', 'fallback', 'error', 'blocked')),
  CONSTRAINT whatsapp_agent_turn_log_confidence_check CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  CONSTRAINT whatsapp_agent_turn_log_duration_check CHECK (duration_ms IS NULL OR duration_ms >= 0)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_channel_tenant ON public.whatsapp_channel(tenant_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_inbound_tenant_received ON public.whatsapp_inbound_message(tenant_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_attachment_tenant ON public.whatsapp_inbound_attachment(tenant_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_attachment_download_status ON public.whatsapp_inbound_attachment(tenant_id, download_status, created_at);
CREATE INDEX IF NOT EXISTS idx_whatsapp_job_tenant_status_created ON public.whatsapp_processing_job(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_job_event_job_created ON public.whatsapp_job_event(job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_job_branch_pending ON public.whatsapp_processing_job(tenant_id, status, branch_prompt_deadline_at);
CREATE INDEX IF NOT EXISTS idx_whatsapp_job_target ON public.whatsapp_processing_job(tenant_id, target_entity_type, target_entity_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_branch_rule_lookup ON public.whatsapp_branch_rule(tenant_id, activa, from_wa_id, phone_number_id, prioridad DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_outbound_status ON public.whatsapp_outbound_message(tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_whatsapp_outbound_retry ON public.whatsapp_outbound_message(tenant_id, status, retry_count, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_actor_active_from_wa ON public.whatsapp_actor(tenant_id, from_wa_id) WHERE activo = TRUE;
CREATE INDEX IF NOT EXISTS idx_whatsapp_actor_tenant_usuario ON public.whatsapp_actor(tenant_id, usuario_id, activo);
CREATE INDEX IF NOT EXISTS idx_whatsapp_actor_tenant_created ON public.whatsapp_actor(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_auth_challenge_actor_status ON public.whatsapp_auth_challenge(actor_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_auth_challenge_tenant_status_expires ON public.whatsapp_auth_challenge(tenant_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_whatsapp_action_pending ON public.whatsapp_action_log(tenant_id, from_wa_id, action_status, confirmation_expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_action_actor_created ON public.whatsapp_action_log(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_platform_routing_expires ON public.whatsapp_platform_routing_state(expires_at);
CREATE INDEX IF NOT EXISTS idx_whatsapp_agent_turn_log_tenant_created ON public.whatsapp_agent_turn_log(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_agent_turn_log_actor_created ON public.whatsapp_agent_turn_log(actor_id, created_at DESC) WHERE actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_whatsapp_agent_turn_log_tenant_filters ON public.whatsapp_agent_turn_log(tenant_id, channel, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_agent_turn_log_tool_created ON public.whatsapp_agent_turn_log(tenant_id, tool_name, created_at DESC) WHERE tool_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_whatsapp_agent_turn_log_intent_created ON public.whatsapp_agent_turn_log(tenant_id, intent, created_at DESC) WHERE intent IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_whatsapp_agent_turn_log_expires ON public.whatsapp_agent_turn_log(expires_at);

DROP TRIGGER IF EXISTS trg_whatsapp_actor_updated_at ON public.whatsapp_actor;
CREATE TRIGGER trg_whatsapp_actor_updated_at
  BEFORE UPDATE ON public.whatsapp_actor
  FOR EACH ROW EXECUTE FUNCTION public.moddatetime('updated_at');

DROP TRIGGER IF EXISTS trg_whatsapp_auth_challenge_updated_at ON public.whatsapp_auth_challenge;
CREATE TRIGGER trg_whatsapp_auth_challenge_updated_at
  BEFORE UPDATE ON public.whatsapp_auth_challenge
  FOR EACH ROW EXECUTE FUNCTION public.moddatetime('updated_at');

DROP TRIGGER IF EXISTS trg_whatsapp_action_log_updated_at ON public.whatsapp_action_log;
CREATE TRIGGER trg_whatsapp_action_log_updated_at
  BEFORE UPDATE ON public.whatsapp_action_log
  FOR EACH ROW EXECUTE FUNCTION public.moddatetime('updated_at');

DROP TRIGGER IF EXISTS trg_whatsapp_agent_feature_flag_updated_at ON public.whatsapp_agent_feature_flag;
CREATE TRIGGER trg_whatsapp_agent_feature_flag_updated_at
  BEFORE UPDATE ON public.whatsapp_agent_feature_flag
  FOR EACH ROW EXECUTE FUNCTION public.moddatetime('updated_at');

DROP TRIGGER IF EXISTS trg_whatsapp_platform_channel_updated_at ON public.whatsapp_platform_channel;
CREATE TRIGGER trg_whatsapp_platform_channel_updated_at
  BEFORE UPDATE ON public.whatsapp_platform_channel
  FOR EACH ROW EXECUTE FUNCTION public.moddatetime('updated_at');

DROP TRIGGER IF EXISTS trg_whatsapp_platform_routing_state_updated_at ON public.whatsapp_platform_routing_state;
CREATE TRIGGER trg_whatsapp_platform_routing_state_updated_at
  BEFORE UPDATE ON public.whatsapp_platform_routing_state
  FOR EACH ROW EXECUTE FUNCTION public.moddatetime('updated_at');
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP TABLE IF EXISTS public.whatsapp_agent_turn_log;
DROP TABLE IF EXISTS public.whatsapp_agent_feature_flag;
DROP TABLE IF EXISTS public.whatsapp_action_log;
DROP TABLE IF EXISTS public.whatsapp_auth_challenge;
DROP TABLE IF EXISTS public.whatsapp_actor;
DROP TABLE IF EXISTS public.whatsapp_job_event;
DROP TABLE IF EXISTS public.whatsapp_outbound_message;
DROP TABLE IF EXISTS public.whatsapp_processing_job;
DROP TABLE IF EXISTS public.whatsapp_branch_rule;
DROP TABLE IF EXISTS public.whatsapp_inbound_attachment;
DROP TABLE IF EXISTS public.whatsapp_inbound_message;
DROP TABLE IF EXISTS public.whatsapp_platform_routing_state;
DROP TABLE IF EXISTS public.whatsapp_platform_channel;
DROP TABLE IF EXISTS public.whatsapp_channel;

DROP TYPE IF EXISTS public.whatsapp_action_status;
DROP TYPE IF EXISTS public.whatsapp_auth_challenge_status;
DROP TYPE IF EXISTS public.whatsapp_actor_trust_level;
DROP TYPE IF EXISTS public.whatsapp_branch_resolution_status;
DROP TYPE IF EXISTS public.whatsapp_job_status;

ALTER TABLE public.modulo_config DROP COLUMN IF EXISTS lector_facturas;
`);
  }
}
