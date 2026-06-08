import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-PAS-001: pasarelas unificadas (integracion, caja, transaccion, webhook_log) + backfill legacy MP.
 */
export class NbPas001PasarelasSchema1750000000000 implements MigrationInterface {
  name = 'NbPas001PasarelasSchema1750000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS public.pasarela_integracion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  sucursal_id uuid NOT NULL REFERENCES public.sucursal (id) ON DELETE CASCADE,
  proveedor text NOT NULL,
  canal text NOT NULL,
  tipo text NOT NULL,
  nombre text NOT NULL,
  estado text NOT NULL DEFAULT 'incompleta',
  config_publica jsonb NOT NULL DEFAULT '{}'::jsonb,
  secretos_cifrados jsonb NOT NULL DEFAULT '{}'::jsonb,
  webhook_public_id uuid NOT NULL DEFAULT gen_random_uuid(),
  origen_legacy text,
  legacy_config_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
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

CREATE TRIGGER pasarela_integracion_set_updated_at
  BEFORE UPDATE ON public.pasarela_integracion
  FOR EACH ROW
  EXECUTE FUNCTION public.moddatetime();

CREATE TABLE IF NOT EXISTS public.pasarela_caja (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  caja_id uuid NOT NULL REFERENCES public.caja (id) ON DELETE CASCADE,
  integracion_id uuid NOT NULL REFERENCES public.pasarela_integracion (id) ON DELETE CASCADE,
  habilitado boolean NOT NULL DEFAULT true,
  alias text,
  orden integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uk_pasarela_caja_integracion UNIQUE (caja_id, integracion_id)
);

CREATE INDEX IF NOT EXISTS idx_pasarela_caja_tenant ON public.pasarela_caja (tenant_id);
CREATE INDEX IF NOT EXISTS idx_pasarela_caja_caja ON public.pasarela_caja (caja_id, orden);
CREATE INDEX IF NOT EXISTS idx_pasarela_caja_integracion ON public.pasarela_caja (integracion_id);

CREATE TRIGGER pasarela_caja_set_updated_at
  BEFORE UPDATE ON public.pasarela_caja
  FOR EACH ROW
  EXECUTE FUNCTION public.moddatetime();

CREATE TABLE IF NOT EXISTS public.pasarela_transaccion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  sucursal_id uuid NOT NULL REFERENCES public.sucursal (id) ON DELETE RESTRICT,
  caja_id uuid REFERENCES public.caja (id) ON DELETE SET NULL,
  integracion_id uuid REFERENCES public.pasarela_integracion (id) ON DELETE SET NULL,
  comprobante_id uuid REFERENCES public.comprobante (id) ON DELETE SET NULL,
  proveedor text NOT NULL,
  canal text NOT NULL,
  tipo text NOT NULL,
  estado text NOT NULL DEFAULT 'creada',
  monto numeric(18, 4) NOT NULL,
  moneda text NOT NULL DEFAULT 'ARS',
  external_reference text,
  external_intent_id text,
  external_order_id text,
  external_payment_id text,
  idempotency_key text,
  request_payload jsonb,
  response_payload jsonb,
  ultimo_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_pasarela_transaccion_canal CHECK (canal IN ('qr', 'terminal')),
  CONSTRAINT chk_pasarela_transaccion_estado CHECK (
    estado IN (
      'creada', 'iniciada', 'pendiente', 'aprobada', 'rechazada', 'cancelada',
      'expirada', 'error', 'fiscalizando', 'fiscal_pendiente', 'fiscal_error', 'completa'
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

CREATE TRIGGER pasarela_transaccion_set_updated_at
  BEFORE UPDATE ON public.pasarela_transaccion
  FOR EACH ROW
  EXECUTE FUNCTION public.moddatetime();

CREATE TABLE IF NOT EXISTS public.pasarela_webhook_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenant (id) ON DELETE SET NULL,
  integracion_id uuid REFERENCES public.pasarela_integracion (id) ON DELETE SET NULL,
  proveedor text NOT NULL,
  webhook_public_id uuid,
  event_id text,
  topic text,
  payload_snippet text,
  headers jsonb,
  procesado boolean NOT NULL DEFAULT false,
  resultado text,
  error_mensaje text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pasarela_webhook_log_created
  ON public.pasarela_webhook_log (created_at DESC);

INSERT INTO public.pasarela_integracion (
  tenant_id, sucursal_id, proveedor, canal, tipo, nombre, estado,
  config_publica, secretos_cifrados, origen_legacy, legacy_config_id
)
SELECT
  c.tenant_id, c.sucursal_id, 'mercado_pago', 'terminal', 'mp_point', 'Mercado Pago Point',
  CASE
    WHEN c.habilitado IS NOT TRUE THEN 'inactiva'
    WHEN NULLIF(trim(COALESCE(c.access_token, '')), '') IS NOT NULL
     AND NULLIF(trim(COALESCE(c.device_id, '')), '') IS NOT NULL THEN 'activa'
    ELSE 'incompleta'
  END,
  jsonb_strip_nulls(jsonb_build_object(
    'device_id', c.device_id, 'habilitado', c.habilitado, 'last_payment_intent_id', c.last_payment_intent_id
  )),
  jsonb_strip_nulls(jsonb_build_object('access_token', c.access_token, 'webhook_secret', c.webhook_secret)),
  'mp_point_config', c.id
FROM public.mp_point_config c
WHERE c.sucursal_id IS NOT NULL
ON CONFLICT (origen_legacy, legacy_config_id)
  WHERE origen_legacy IS NOT NULL AND legacy_config_id IS NOT NULL
  DO NOTHING;

INSERT INTO public.pasarela_integracion (
  tenant_id, sucursal_id, proveedor, canal, tipo, nombre, estado,
  config_publica, secretos_cifrados, origen_legacy, legacy_config_id
)
SELECT
  c.tenant_id, c.sucursal_id, 'mercado_pago', 'qr', 'mp_qr', 'Mercado Pago QR',
  CASE
    WHEN c.habilitado IS NOT TRUE THEN 'inactiva'
    WHEN NULLIF(trim(COALESCE(c.access_token, '')), '') IS NOT NULL
     AND NULLIF(trim(COALESCE(c.user_id, '')), '') IS NOT NULL
     AND NULLIF(trim(COALESCE(c.external_pos_id, '')), '') IS NOT NULL THEN 'activa'
    ELSE 'incompleta'
  END,
  jsonb_strip_nulls(jsonb_build_object(
    'user_id', c.user_id, 'external_pos_id', c.external_pos_id, 'habilitado', c.habilitado,
    'mp_transferencia_habilitada', c.transferencia_habilitada
  )),
  jsonb_strip_nulls(jsonb_build_object('access_token', c.access_token, 'webhook_secret', c.webhook_secret)),
  'mp_qr_config', c.id
FROM public.mp_qr_config c
WHERE c.sucursal_id IS NOT NULL
ON CONFLICT (origen_legacy, legacy_config_id)
  WHERE origen_legacy IS NOT NULL AND legacy_config_id IS NOT NULL
  DO NOTHING;

INSERT INTO public.pasarela_caja (tenant_id, caja_id, integracion_id, habilitado, alias, orden)
SELECT i.tenant_id, c.id, i.id, true, NULL,
  CASE i.canal WHEN 'terminal' THEN 10 WHEN 'qr' THEN 20 ELSE 100 END
FROM public.pasarela_integracion i
JOIN public.caja c ON c.tenant_id = i.tenant_id AND c.sucursal_id = i.sucursal_id AND c.activa = true
WHERE i.proveedor = 'mercado_pago' AND i.tipo IN ('mp_point', 'mp_qr') AND i.estado = 'activa'
ON CONFLICT (caja_id, integracion_id) DO NOTHING;
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP TABLE IF EXISTS public.pasarela_webhook_log CASCADE;
DROP TABLE IF EXISTS public.pasarela_transaccion CASCADE;
DROP TRIGGER IF EXISTS pasarela_caja_set_updated_at ON public.pasarela_caja;
DROP TABLE IF EXISTS public.pasarela_caja CASCADE;
DROP TRIGGER IF EXISTS pasarela_integracion_set_updated_at ON public.pasarela_integracion;
DROP TABLE IF EXISTS public.pasarela_integracion CASCADE;
`);
  }
}
