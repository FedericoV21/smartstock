-- Pasarelas externas unificadas.
-- Modelo aditivo y conservador: no elimina tablas/columnas legacy de Mercado Pago.

BEGIN;

CREATE TABLE IF NOT EXISTS public.pasarela_integracion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  sucursal_id UUID NOT NULL REFERENCES public.sucursal (id) ON DELETE CASCADE,
  proveedor TEXT NOT NULL,
  canal TEXT NOT NULL,
  tipo TEXT NOT NULL,
  nombre TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'incompleta',
  config_publica JSONB NOT NULL DEFAULT '{}'::jsonb,
  secretos_cifrados JSONB NOT NULL DEFAULT '{}'::jsonb,
  webhook_public_id UUID NOT NULL DEFAULT gen_random_uuid(),
  origen_legacy TEXT,
  legacy_config_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_pasarela_integracion_canal CHECK (canal IN ('qr', 'terminal')),
  CONSTRAINT chk_pasarela_integracion_estado CHECK (estado IN ('activa', 'inactiva', 'incompleta')),
  CONSTRAINT chk_pasarela_integracion_proveedor CHECK (proveedor ~ '^[a-z0-9_]+$'),
  CONSTRAINT chk_pasarela_integracion_tipo CHECK (tipo ~ '^[a-z0-9_]+$')
);

CREATE UNIQUE INDEX IF NOT EXISTS uk_pasarela_integracion_webhook_public_id
  ON public.pasarela_integracion (webhook_public_id);

CREATE UNIQUE INDEX IF NOT EXISTS uk_pasarela_integracion_legacy
  ON public.pasarela_integracion (origen_legacy, legacy_config_id)
  WHERE origen_legacy IS NOT NULL AND legacy_config_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pasarela_integracion_tenant_sucursal
  ON public.pasarela_integracion (tenant_id, sucursal_id);

CREATE INDEX IF NOT EXISTS idx_pasarela_integracion_tipo
  ON public.pasarela_integracion (proveedor, tipo, canal);

COMMENT ON TABLE public.pasarela_integracion IS
  'Conexion unica de una pasarela externa por sucursal. Puede enlazarse a multiples cajas.';

COMMENT ON COLUMN public.pasarela_integracion.secretos_cifrados IS
  'Secretos cifrados por aplicacion. Backfills legacy conservan valores existentes cuando ya venian cifrados.';

CREATE TRIGGER set_pasarela_integracion_updated_at
  BEFORE UPDATE ON public.pasarela_integracion
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime (updated_at);

CREATE TABLE IF NOT EXISTS public.pasarela_caja (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  caja_id UUID NOT NULL REFERENCES public.caja (id) ON DELETE CASCADE,
  integracion_id UUID NOT NULL REFERENCES public.pasarela_integracion (id) ON DELETE CASCADE,
  habilitado BOOLEAN NOT NULL DEFAULT true,
  alias TEXT,
  orden INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uk_pasarela_caja_integracion UNIQUE (caja_id, integracion_id)
);

CREATE INDEX IF NOT EXISTS idx_pasarela_caja_tenant
  ON public.pasarela_caja (tenant_id);

CREATE INDEX IF NOT EXISTS idx_pasarela_caja_caja
  ON public.pasarela_caja (caja_id, orden);

CREATE INDEX IF NOT EXISTS idx_pasarela_caja_integracion
  ON public.pasarela_caja (integracion_id);

COMMENT ON TABLE public.pasarela_caja IS
  'Relacion muchos-a-muchos entre cajas e integraciones de pasarelas.';

CREATE TRIGGER set_pasarela_caja_updated_at
  BEFORE UPDATE ON public.pasarela_caja
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime (updated_at);

CREATE TABLE IF NOT EXISTS public.pasarela_transaccion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  sucursal_id UUID NOT NULL REFERENCES public.sucursal (id) ON DELETE RESTRICT,
  caja_id UUID REFERENCES public.caja (id) ON DELETE SET NULL,
  integracion_id UUID NOT NULL REFERENCES public.pasarela_integracion (id) ON DELETE RESTRICT,
  comprobante_id UUID REFERENCES public.comprobante (id) ON DELETE SET NULL,
  proveedor TEXT NOT NULL,
  canal TEXT NOT NULL,
  tipo TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'creada',
  monto NUMERIC(18, 4) NOT NULL,
  moneda TEXT NOT NULL DEFAULT 'ARS',
  external_reference TEXT,
  external_intent_id TEXT,
  external_order_id TEXT,
  external_payment_id TEXT,
  idempotency_key TEXT,
  request_payload JSONB,
  response_payload JSONB,
  ultimo_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_pasarela_transaccion_canal CHECK (canal IN ('qr', 'terminal')),
  CONSTRAINT chk_pasarela_transaccion_estado CHECK (
    estado IN (
      'creada',
      'iniciada',
      'pendiente',
      'aprobada',
      'rechazada',
      'cancelada',
      'expirada',
      'error',
      'fiscalizando',
      'fiscal_pendiente',
      'fiscal_error',
      'completa'
    )
  ),
  CONSTRAINT chk_pasarela_transaccion_monto CHECK (monto > 0)
);

CREATE INDEX IF NOT EXISTS idx_pasarela_transaccion_comprobante
  ON public.pasarela_transaccion (comprobante_id)
  WHERE comprobante_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pasarela_transaccion_integracion_created
  ON public.pasarela_transaccion (integracion_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uk_pasarela_transaccion_integracion_activa
  ON public.pasarela_transaccion (integracion_id)
  WHERE estado IN ('creada', 'iniciada', 'pendiente', 'fiscalizando');

CREATE UNIQUE INDEX IF NOT EXISTS uk_pasarela_transaccion_external_intent
  ON public.pasarela_transaccion (integracion_id, external_intent_id)
  WHERE external_intent_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uk_pasarela_transaccion_external_order
  ON public.pasarela_transaccion (integracion_id, external_order_id)
  WHERE external_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uk_pasarela_transaccion_idempotency
  ON public.pasarela_transaccion (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON TABLE public.pasarela_transaccion IS
  'Intento de cobro normalizado para pasarelas externas. Bloquea integracion fisica mientras hay cobro activo.';

CREATE TRIGGER set_pasarela_transaccion_updated_at
  BEFORE UPDATE ON public.pasarela_transaccion
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime (updated_at);

CREATE TABLE IF NOT EXISTS public.pasarela_webhook_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenant (id) ON DELETE SET NULL,
  integracion_id UUID REFERENCES public.pasarela_integracion (id) ON DELETE SET NULL,
  proveedor TEXT NOT NULL,
  webhook_public_id UUID,
  event_id TEXT,
  topic TEXT,
  payload_snippet TEXT,
  headers JSONB,
  procesado BOOLEAN NOT NULL DEFAULT false,
  resultado TEXT,
  error_mensaje TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pasarela_webhook_log_created
  ON public.pasarela_webhook_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pasarela_webhook_log_integracion
  ON public.pasarela_webhook_log (integracion_id, created_at DESC)
  WHERE integracion_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uk_pasarela_webhook_log_event
  ON public.pasarela_webhook_log (integracion_id, event_id)
  WHERE integracion_id IS NOT NULL AND event_id IS NOT NULL;

COMMENT ON TABLE public.pasarela_webhook_log IS
  'Recepcion, trazabilidad e idempotencia de webhooks de pasarelas externas.';

ALTER TABLE public.pasarela_integracion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pasarela_caja ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pasarela_transaccion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pasarela_webhook_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_select_pasarela_integracion ON public.pasarela_integracion FOR SELECT
  USING (tenant_id = public.current_tenant_id ());
CREATE POLICY tenant_insert_pasarela_integracion ON public.pasarela_integracion FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id ());
CREATE POLICY tenant_update_pasarela_integracion ON public.pasarela_integracion FOR UPDATE
  USING (tenant_id = public.current_tenant_id ())
  WITH CHECK (tenant_id = public.current_tenant_id ());
CREATE POLICY tenant_delete_pasarela_integracion ON public.pasarela_integracion FOR DELETE
  USING (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_select_pasarela_caja ON public.pasarela_caja FOR SELECT
  USING (tenant_id = public.current_tenant_id ());
CREATE POLICY tenant_insert_pasarela_caja ON public.pasarela_caja FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id ());
CREATE POLICY tenant_update_pasarela_caja ON public.pasarela_caja FOR UPDATE
  USING (tenant_id = public.current_tenant_id ())
  WITH CHECK (tenant_id = public.current_tenant_id ());
CREATE POLICY tenant_delete_pasarela_caja ON public.pasarela_caja FOR DELETE
  USING (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_select_pasarela_transaccion ON public.pasarela_transaccion FOR SELECT
  USING (tenant_id = public.current_tenant_id ());
CREATE POLICY tenant_insert_pasarela_transaccion ON public.pasarela_transaccion FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id ());
CREATE POLICY tenant_update_pasarela_transaccion ON public.pasarela_transaccion FOR UPDATE
  USING (tenant_id = public.current_tenant_id ())
  WITH CHECK (tenant_id = public.current_tenant_id ());
CREATE POLICY tenant_delete_pasarela_transaccion ON public.pasarela_transaccion FOR DELETE
  USING (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_select_pasarela_webhook_log ON public.pasarela_webhook_log FOR SELECT
  USING (tenant_id = public.current_tenant_id ());
CREATE POLICY tenant_insert_pasarela_webhook_log ON public.pasarela_webhook_log FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id ());

GRANT ALL ON TABLE public.pasarela_integracion TO anon;
GRANT ALL ON TABLE public.pasarela_integracion TO authenticated;
GRANT ALL ON TABLE public.pasarela_integracion TO service_role;
GRANT ALL ON TABLE public.pasarela_caja TO anon;
GRANT ALL ON TABLE public.pasarela_caja TO authenticated;
GRANT ALL ON TABLE public.pasarela_caja TO service_role;
GRANT ALL ON TABLE public.pasarela_transaccion TO anon;
GRANT ALL ON TABLE public.pasarela_transaccion TO authenticated;
GRANT ALL ON TABLE public.pasarela_transaccion TO service_role;
GRANT ALL ON TABLE public.pasarela_webhook_log TO anon;
GRANT ALL ON TABLE public.pasarela_webhook_log TO authenticated;
GRANT ALL ON TABLE public.pasarela_webhook_log TO service_role;

-- Backfill Mercado Pago Point: una integracion por config legacy.
INSERT INTO public.pasarela_integracion (
  tenant_id,
  sucursal_id,
  proveedor,
  canal,
  tipo,
  nombre,
  estado,
  config_publica,
  secretos_cifrados,
  origen_legacy,
  legacy_config_id
)
SELECT
  c.tenant_id,
  c.sucursal_id,
  'mercado_pago',
  'terminal',
  'mp_point',
  'Mercado Pago Point',
  CASE
    WHEN c.habilitado IS NOT TRUE THEN 'inactiva'
    WHEN NULLIF(trim(COALESCE(c.access_token, '')), '') IS NOT NULL
     AND NULLIF(trim(COALESCE(c.device_id, '')), '') IS NOT NULL THEN 'activa'
    ELSE 'incompleta'
  END,
  jsonb_strip_nulls(
    jsonb_build_object(
      'device_id', c.device_id,
      'habilitado', c.habilitado,
      'last_payment_intent_id', c.last_payment_intent_id
    )
  ),
  jsonb_strip_nulls(
    jsonb_build_object(
      'access_token', c.access_token,
      'webhook_secret', c.webhook_secret
    )
  ),
  'mp_point_config',
  c.id
FROM public.mp_point_config c
WHERE c.sucursal_id IS NOT NULL
ON CONFLICT (origen_legacy, legacy_config_id)
  WHERE origen_legacy IS NOT NULL AND legacy_config_id IS NOT NULL
  DO NOTHING;

-- Backfill Mercado Pago QR: una integracion por config legacy.
INSERT INTO public.pasarela_integracion (
  tenant_id,
  sucursal_id,
  proveedor,
  canal,
  tipo,
  nombre,
  estado,
  config_publica,
  secretos_cifrados,
  origen_legacy,
  legacy_config_id
)
SELECT
  c.tenant_id,
  c.sucursal_id,
  'mercado_pago',
  'qr',
  'mp_qr',
  'Mercado Pago QR',
  CASE
    WHEN c.habilitado IS NOT TRUE THEN 'inactiva'
    WHEN NULLIF(trim(COALESCE(c.access_token, '')), '') IS NOT NULL
     AND NULLIF(trim(COALESCE(c.user_id, '')), '') IS NOT NULL
     AND NULLIF(trim(COALESCE(c.external_pos_id, '')), '') IS NOT NULL THEN 'activa'
    ELSE 'incompleta'
  END,
  jsonb_strip_nulls(
    jsonb_build_object(
      'user_id', c.user_id,
      'external_pos_id', c.external_pos_id,
      'habilitado', c.habilitado
    )
  ),
  jsonb_strip_nulls(
    jsonb_build_object(
      'access_token', c.access_token,
      'webhook_secret', c.webhook_secret
    )
  ),
  'mp_qr_config',
  c.id
FROM public.mp_qr_config c
WHERE c.sucursal_id IS NOT NULL
ON CONFLICT (origen_legacy, legacy_config_id)
  WHERE origen_legacy IS NOT NULL AND legacy_config_id IS NOT NULL
  DO NOTHING;

-- Enlace conservador: toda conexion MP activa queda disponible en todas las cajas activas de su sucursal.
INSERT INTO public.pasarela_caja (
  tenant_id,
  caja_id,
  integracion_id,
  habilitado,
  alias,
  orden
)
SELECT
  i.tenant_id,
  c.id,
  i.id,
  true,
  NULL,
  CASE i.canal WHEN 'terminal' THEN 10 WHEN 'qr' THEN 20 ELSE 100 END
FROM public.pasarela_integracion i
JOIN public.caja c
  ON c.tenant_id = i.tenant_id
 AND c.sucursal_id = i.sucursal_id
 AND c.activa = true
WHERE i.proveedor = 'mercado_pago'
  AND i.tipo IN ('mp_point', 'mp_qr')
  AND i.estado = 'activa'
ON CONFLICT (caja_id, integracion_id) DO NOTHING;

COMMIT;
