-- Ajuste % por método rápido del POS (efectivo, débito, etc.): recargo positivo o descuento negativo.
-- Idempotente: se puede volver a ejecutar en SQL Editor si falló un intento previo.

CREATE TABLE IF NOT EXISTS public.medio_pago_rapido (
  tenant_id UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  codigo VARCHAR(20) NOT NULL,
  recargo_porcentaje NUMERIC(12, 4) NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, codigo),
  CONSTRAINT chk_medio_pago_rapido_codigo CHECK (
    codigo IN (
      'efectivo',
      'debito',
      'credito',
      'transferencia',
      'mixto'
    )
  )
);

ALTER TABLE public.medio_pago_rapido ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select_medio_pago_rapido ON public.medio_pago_rapido;
DROP POLICY IF EXISTS tenant_insert_medio_pago_rapido ON public.medio_pago_rapido;
DROP POLICY IF EXISTS tenant_update_medio_pago_rapido ON public.medio_pago_rapido;
DROP POLICY IF EXISTS tenant_delete_medio_pago_rapido ON public.medio_pago_rapido;

CREATE POLICY tenant_select_medio_pago_rapido
  ON public.medio_pago_rapido FOR SELECT
  USING (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_insert_medio_pago_rapido
  ON public.medio_pago_rapido FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_update_medio_pago_rapido
  ON public.medio_pago_rapido FOR UPDATE
  USING (tenant_id = public.current_tenant_id ())
  WITH CHECK (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_delete_medio_pago_rapido
  ON public.medio_pago_rapido FOR DELETE
  USING (tenant_id = public.current_tenant_id ());
