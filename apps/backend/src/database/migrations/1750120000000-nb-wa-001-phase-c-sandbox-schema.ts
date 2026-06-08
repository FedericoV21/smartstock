import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-WA-001 Phase C: WhatsApp sandbox schema (no RLS — Nest uses app-level tenant guard).
 * Paridad Supabase 166_whatsapp_sandbox_chat.sql + 170_whatsapp_sandbox_invoice_ticket.sql
 */
export class NbWa001PhaseCSandboxSchema1750120000000 implements MigrationInterface {
  name = 'NbWa001PhaseCSandboxSchema1750120000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS public.whatsapp_sandbox_message (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL REFERENCES public.usuario(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES public.whatsapp_actor(id) ON DELETE SET NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_sandbox_message_role_check
    CHECK (role IN ('user', 'assistant', 'system'))
);

CREATE TABLE IF NOT EXISTS public.whatsapp_sandbox_pending_action (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL REFERENCES public.usuario(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES public.whatsapp_actor(id) ON DELETE CASCADE,
  from_wa_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_confirmation',
  action_signature TEXT NOT NULL,
  confirmation_token TEXT NOT NULL,
  confirmation_expires_at TIMESTAMPTZ NOT NULL,
  action_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_payload JSONB,
  error_detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ,
  CONSTRAINT whatsapp_sandbox_pending_action_status_check
    CHECK (status IN ('pending_confirmation', 'simulated', 'cancelled', 'error'))
);

CREATE TABLE IF NOT EXISTS public.whatsapp_sandbox_invoice_ticket (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL REFERENCES public.usuario(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES public.whatsapp_actor(id) ON DELETE CASCADE,
  from_wa_id TEXT NOT NULL,
  lector_factura_job_id UUID NOT NULL REFERENCES public.lector_factura_job(id) ON DELETE CASCADE,
  action_log_id UUID REFERENCES public.whatsapp_action_log(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'needs_review',
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  pending_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  chat_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  impact_hash TEXT,
  error_detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ,
  CONSTRAINT whatsapp_sandbox_invoice_ticket_status_check
    CHECK (status IN ('needs_review', 'ready', 'closed', 'applied', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_sandbox_message_user_created
  ON public.whatsapp_sandbox_message(tenant_id, usuario_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_sandbox_pending_action_user_status
  ON public.whatsapp_sandbox_pending_action(tenant_id, usuario_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_sandbox_pending_action_signature
  ON public.whatsapp_sandbox_pending_action(tenant_id, usuario_id, action_signature)
  WHERE status = 'pending_confirmation';

CREATE INDEX IF NOT EXISTS idx_whatsapp_sandbox_invoice_ticket_user_status
  ON public.whatsapp_sandbox_invoice_ticket(tenant_id, usuario_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_sandbox_invoice_ticket_job
  ON public.whatsapp_sandbox_invoice_ticket(tenant_id, lector_factura_job_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_sandbox_invoice_ticket_action
  ON public.whatsapp_sandbox_invoice_ticket(action_log_id)
  WHERE action_log_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_whatsapp_sandbox_pending_action_updated_at
  ON public.whatsapp_sandbox_pending_action;
CREATE TRIGGER trg_whatsapp_sandbox_pending_action_updated_at
  BEFORE UPDATE ON public.whatsapp_sandbox_pending_action
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

DROP TRIGGER IF EXISTS trg_whatsapp_sandbox_invoice_ticket_updated_at
  ON public.whatsapp_sandbox_invoice_ticket;
CREATE TRIGGER trg_whatsapp_sandbox_invoice_ticket_updated_at
  BEFORE UPDATE ON public.whatsapp_sandbox_invoice_ticket
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP TRIGGER IF EXISTS trg_whatsapp_sandbox_invoice_ticket_updated_at ON public.whatsapp_sandbox_invoice_ticket;
DROP TRIGGER IF EXISTS trg_whatsapp_sandbox_pending_action_updated_at ON public.whatsapp_sandbox_pending_action;
DROP TABLE IF EXISTS public.whatsapp_sandbox_invoice_ticket;
DROP TABLE IF EXISTS public.whatsapp_sandbox_pending_action;
DROP TABLE IF EXISTS public.whatsapp_sandbox_message;
`);
  }
}
