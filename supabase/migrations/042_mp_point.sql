-- V70-MP-001: Mercado Pago Point — configuración por tenant (tabla dedicada, patrón arca_config),
-- columnas de correlación en comprobante, estado pendiente_posnet.
-- El access_token se persiste cifrado desde la app (mismo esquema iv:hex que arca_config).

-- ─── Estado de comprobante: cobro en curso en terminal MP Point ─────────────────
ALTER TYPE public.estado_comprobante ADD VALUE IF NOT EXISTS 'pendiente_posnet';

-- ─── Tabla mp_point_config (un registro por tenant) ──────────────────────────
CREATE TABLE public.mp_point_config (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid (),
  tenant_id       UUID NOT NULL UNIQUE REFERENCES public.tenant (id) ON DELETE CASCADE,
  access_token    TEXT,
  device_id       TEXT,
  webhook_secret  TEXT,
  habilitado      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now (),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now ()
);

COMMENT ON TABLE public.mp_point_config IS
  'Credenciales y preferencias Mercado Pago Point por tenant. access_token cifrado en aplicación.';

CREATE INDEX idx_mp_point_config_tenant ON public.mp_point_config (tenant_id);

CREATE TRIGGER set_mp_point_config_updated_at
  BEFORE UPDATE ON public.mp_point_config
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime (updated_at);

ALTER TABLE public.mp_point_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_select_mp_point_config
  ON public.mp_point_config FOR SELECT
  USING (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_insert_mp_point_config
  ON public.mp_point_config FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_update_mp_point_config
  ON public.mp_point_config FOR UPDATE
  USING (tenant_id = public.current_tenant_id ())
  WITH CHECK (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_delete_mp_point_config
  ON public.mp_point_config FOR DELETE
  USING (tenant_id = public.current_tenant_id ());

-- ─── Comprobante: intent y pago MP Point ─────────────────────────────────────
ALTER TABLE public.comprobante
  ADD COLUMN IF NOT EXISTS mp_point_intent_id TEXT,
  ADD COLUMN IF NOT EXISTS mp_point_payment_id BIGINT;

COMMENT ON COLUMN public.comprobante.mp_point_intent_id IS
  'ID del payment intent en API Mercado Pago Point (correlación webhook / cancelar).';

COMMENT ON COLUMN public.comprobante.mp_point_payment_id IS
  'ID del pago aprobado en Mercado Pago cuando el cobro en terminal finaliza OK.';

-- Índice para webhook: localizar comprobante por intent en el tenant
CREATE INDEX IF NOT EXISTS idx_comprobante_mp_intent
  ON public.comprobante (tenant_id, mp_point_intent_id)
  WHERE mp_point_intent_id IS NOT NULL;

-- metodo_pago es VARCHAR en 027: valor permitido adicional documentado — 'posnet_mp'
