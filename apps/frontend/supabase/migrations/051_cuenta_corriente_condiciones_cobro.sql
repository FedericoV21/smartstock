-- Condiciones de cobro y tipo de cuenta corriente (cliente / empleado).
-- Requiere cuenta_corriente (020, 046).

CREATE TYPE public.tipo_cuenta_corriente AS ENUM ('cliente', 'empleado');

CREATE TYPE public.cobro_modalidad AS ENUM ('por_comprobante', 'periodico');

CREATE TYPE public.cobro_periodicidad AS ENUM ('semanal', 'quincenal', 'mensual');

ALTER TABLE public.cuenta_corriente
  ADD COLUMN IF NOT EXISTS tipo_cuenta public.tipo_cuenta_corriente NOT NULL DEFAULT 'cliente',
  ADD COLUMN IF NOT EXISTS cobro_modalidad public.cobro_modalidad NOT NULL DEFAULT 'por_comprobante',
  ADD COLUMN IF NOT EXISTS cobro_dias_plazo INTEGER NOT NULL DEFAULT 7
    CONSTRAINT chk_cuenta_corriente_dias_plazo_rango CHECK (
      cobro_dias_plazo >= 1 AND cobro_dias_plazo <= 3650
    ),
  ADD COLUMN IF NOT EXISTS cobro_periodicidad public.cobro_periodicidad NULL,
  ADD COLUMN IF NOT EXISTS cobro_monto_minimo NUMERIC(18, 6) NOT NULL DEFAULT 0
    CONSTRAINT chk_cuenta_corriente_monto_minimo_no_neg CHECK (cobro_monto_minimo >= 0);

ALTER TABLE public.cuenta_corriente
  ADD CONSTRAINT chk_cuenta_corriente_cobro_coherente CHECK (
    (
      cobro_modalidad = 'por_comprobante'
      AND cobro_periodicidad IS NULL
    )
    OR (
      cobro_modalidad = 'periodico'
      AND cobro_periodicidad IS NOT NULL
    )
  );

COMMENT ON COLUMN public.cuenta_corriente.tipo_cuenta IS
  'Clasificación de la cuenta (cliente comercial vs empleado). Solo aplica cuando cliente_id está definido.';
COMMENT ON COLUMN public.cuenta_corriente.cobro_modalidad IS
  'por_comprobante: plazo en días desde la emisión; periodico: vencimiento según periodicidad.';
COMMENT ON COLUMN public.cuenta_corriente.cobro_dias_plazo IS
  'Días hasta el vencimiento cuando cobro_modalidad = por_comprobante (ignorado en periodico).';
COMMENT ON COLUMN public.cuenta_corriente.cobro_periodicidad IS
  'Solo si cobro_modalidad = periodico: ritmo de vencimiento (mapeado a días en la app).';
COMMENT ON COLUMN public.cuenta_corriente.cobro_monto_minimo IS
  'Monto mínimo por cobro (salvo liquidación total del saldo de la factura).';
