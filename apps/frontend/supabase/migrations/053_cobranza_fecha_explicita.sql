-- Vencimiento explícito: día fijo del mes en cuenta corriente + fecha en comprobante.
-- Requiere 051_cuenta_corriente_condiciones_cobro y 052_cobro_modalidad_dia_fijo_mes.

ALTER TABLE public.cuenta_corriente
  ADD COLUMN IF NOT EXISTS cobro_dia_vencimiento_mes SMALLINT NULL
    CONSTRAINT chk_cuenta_corriente_dia_mes_rango CHECK (
      cobro_dia_vencimiento_mes IS NULL
      OR (cobro_dia_vencimiento_mes >= 1 AND cobro_dia_vencimiento_mes <= 31)
    );

ALTER TABLE public.cuenta_corriente
  DROP CONSTRAINT IF EXISTS chk_cuenta_corriente_cobro_coherente;

ALTER TABLE public.cuenta_corriente
  ADD CONSTRAINT chk_cuenta_corriente_cobro_coherente CHECK (
    (
      cobro_modalidad = 'por_comprobante'
      AND cobro_periodicidad IS NULL
      AND cobro_dia_vencimiento_mes IS NULL
    )
    OR (
      cobro_modalidad = 'periodico'
      AND cobro_periodicidad IS NOT NULL
      AND cobro_dia_vencimiento_mes IS NULL
    )
    OR (
      cobro_modalidad = 'dia_fijo_mes'
      AND cobro_periodicidad IS NULL
      AND cobro_dia_vencimiento_mes IS NOT NULL
    )
  );

COMMENT ON COLUMN public.cuenta_corriente.cobro_dia_vencimiento_mes IS
  'Si cobro_modalidad = dia_fijo_mes: día del mes (1–31) para el próximo vencimiento desde la emisión.';

ALTER TABLE public.comprobante
  ADD COLUMN IF NOT EXISTS fecha_vencimiento_pago DATE NULL;

COMMENT ON COLUMN public.comprobante.fecha_vencimiento_pago IS
  'Vencimiento de pago explícito de la operación; si está definido, prevalece sobre las reglas de cuenta corriente al generar cobranza_factura.';
