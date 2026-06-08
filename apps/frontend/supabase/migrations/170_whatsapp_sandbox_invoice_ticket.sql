-- Ticket persistente para facturas cargadas desde el chat sandbox de WhatsApp.

BEGIN;

CREATE TABLE IF NOT EXISTS public.whatsapp_sandbox_invoice_ticket (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  usuario_id uuid NOT NULL REFERENCES public.usuario(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES public.whatsapp_actor(id) ON DELETE CASCADE,
  from_wa_id text NOT NULL,
  lector_factura_job_id uuid NOT NULL REFERENCES public.lector_factura_job(id) ON DELETE CASCADE,
  action_log_id uuid REFERENCES public.whatsapp_action_log(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'needs_review',
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  pending_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  chat_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  impact_hash text,
  error_detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  applied_at timestamptz,
  CONSTRAINT whatsapp_sandbox_invoice_ticket_status_check
    CHECK (status IN ('needs_review', 'ready', 'closed', 'applied', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_sandbox_invoice_ticket_user_status
  ON public.whatsapp_sandbox_invoice_ticket(tenant_id, usuario_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_sandbox_invoice_ticket_job
  ON public.whatsapp_sandbox_invoice_ticket(tenant_id, lector_factura_job_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_sandbox_invoice_ticket_action
  ON public.whatsapp_sandbox_invoice_ticket(action_log_id)
  WHERE action_log_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_whatsapp_sandbox_invoice_ticket_updated_at
  ON public.whatsapp_sandbox_invoice_ticket;
CREATE TRIGGER trg_whatsapp_sandbox_invoice_ticket_updated_at
  BEFORE UPDATE ON public.whatsapp_sandbox_invoice_ticket
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

ALTER TABLE public.whatsapp_sandbox_invoice_ticket ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_sandbox_invoice_ticket_tenant_user_select
  ON public.whatsapp_sandbox_invoice_ticket;
CREATE POLICY whatsapp_sandbox_invoice_ticket_tenant_user_select
  ON public.whatsapp_sandbox_invoice_ticket
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.current_tenant_id() AND usuario_id = auth.uid());

DROP POLICY IF EXISTS whatsapp_sandbox_invoice_ticket_tenant_user_insert
  ON public.whatsapp_sandbox_invoice_ticket;
CREATE POLICY whatsapp_sandbox_invoice_ticket_tenant_user_insert
  ON public.whatsapp_sandbox_invoice_ticket
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND usuario_id = auth.uid());

DROP POLICY IF EXISTS whatsapp_sandbox_invoice_ticket_tenant_user_update
  ON public.whatsapp_sandbox_invoice_ticket;
CREATE POLICY whatsapp_sandbox_invoice_ticket_tenant_user_update
  ON public.whatsapp_sandbox_invoice_ticket
  FOR UPDATE
  TO authenticated
  USING (tenant_id = public.current_tenant_id() AND usuario_id = auth.uid())
  WITH CHECK (tenant_id = public.current_tenant_id() AND usuario_id = auth.uid());

COMMIT;
