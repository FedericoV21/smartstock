-- Mercado Pago transferencias reales (CVU/alias) conciliadas desde POS.

ALTER TYPE public.estado_comprobante ADD VALUE IF NOT EXISTS 'pendiente_transferencia_mp';

CREATE TABLE IF NOT EXISTS public.mp_transferencia_reporte (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  sucursal_id UUID NOT NULL REFERENCES public.sucursal (id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  begin_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  estado TEXT NOT NULL DEFAULT 'solicitado',
  mp_report_id TEXT,
  file_name TEXT,
  raw_response JSONB,
  ultimo_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_mp_transferencia_reporte_estado CHECK (
    estado IN ('solicitado', 'listo', 'descargado', 'error')
  ),
  CONSTRAINT uq_mp_transferencia_reporte_dia UNIQUE (tenant_id, sucursal_id, fecha)
);

CREATE INDEX IF NOT EXISTS idx_mp_transferencia_reporte_estado
  ON public.mp_transferencia_reporte (tenant_id, sucursal_id, estado, fecha DESC);

DROP TRIGGER IF EXISTS set_mp_transferencia_reporte_updated_at ON public.mp_transferencia_reporte;
CREATE TRIGGER set_mp_transferencia_reporte_updated_at
  BEFORE UPDATE ON public.mp_transferencia_reporte
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime (updated_at);

CREATE TABLE IF NOT EXISTS public.mp_transferencia_movimiento (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  sucursal_id UUID NOT NULL REFERENCES public.sucursal (id) ON DELETE CASCADE,
  reporte_id UUID REFERENCES public.mp_transferencia_reporte (id) ON DELETE SET NULL,
  mp_movimiento_id TEXT NOT NULL,
  fecha_operacion DATE NOT NULL,
  fecha_hora TIMESTAMPTZ,
  monto NUMERIC(18, 2) NOT NULL,
  moneda TEXT NOT NULL DEFAULT 'ARS',
  transaction_type TEXT,
  payment_type TEXT,
  descripcion TEXT,
  contraparte TEXT,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_mp_transferencia_movimiento_monto CHECK (monto > 0),
  CONSTRAINT uq_mp_transferencia_movimiento_mp_id UNIQUE (tenant_id, mp_movimiento_id)
);

CREATE INDEX IF NOT EXISTS idx_mp_transferencia_movimiento_match
  ON public.mp_transferencia_movimiento (tenant_id, sucursal_id, fecha_operacion, monto);

DROP TRIGGER IF EXISTS set_mp_transferencia_movimiento_updated_at ON public.mp_transferencia_movimiento;
CREATE TRIGGER set_mp_transferencia_movimiento_updated_at
  BEFORE UPDATE ON public.mp_transferencia_movimiento
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime (updated_at);

CREATE TABLE IF NOT EXISTS public.mp_transferencia_verificacion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  sucursal_id UUID NOT NULL REFERENCES public.sucursal (id) ON DELETE CASCADE,
  comprobante_id UUID NOT NULL REFERENCES public.comprobante (id) ON DELETE CASCADE,
  movimiento_id UUID REFERENCES public.mp_transferencia_movimiento (id) ON DELETE SET NULL,
  mp_movimiento_id TEXT NOT NULL,
  monto NUMERIC(18, 2) NOT NULL,
  fecha_operacion DATE NOT NULL,
  usuario_id UUID REFERENCES public.usuario (id) ON DELETE SET NULL,
  estado TEXT NOT NULL DEFAULT 'reservado',
  verificado_at TIMESTAMPTZ,
  ultimo_error TEXT,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_mp_transferencia_verificacion_estado CHECK (
    estado IN ('reservado', 'verificado', 'error')
  ),
  CONSTRAINT uq_mp_transferencia_verificacion_mp_id UNIQUE (tenant_id, mp_movimiento_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mp_transferencia_verificacion_comprobante_activa
  ON public.mp_transferencia_verificacion (comprobante_id)
  WHERE estado IN ('reservado', 'verificado');

CREATE INDEX IF NOT EXISTS idx_mp_transferencia_verificacion_tenant
  ON public.mp_transferencia_verificacion (tenant_id, sucursal_id, created_at DESC);

DROP TRIGGER IF EXISTS set_mp_transferencia_verificacion_updated_at ON public.mp_transferencia_verificacion;
CREATE TRIGGER set_mp_transferencia_verificacion_updated_at
  BEFORE UPDATE ON public.mp_transferencia_verificacion
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime (updated_at);

ALTER TABLE public.mp_transferencia_reporte ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mp_transferencia_movimiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mp_transferencia_verificacion ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select_mp_transferencia_reporte ON public.mp_transferencia_reporte;
DROP POLICY IF EXISTS tenant_insert_mp_transferencia_reporte ON public.mp_transferencia_reporte;
DROP POLICY IF EXISTS tenant_update_mp_transferencia_reporte ON public.mp_transferencia_reporte;
DROP POLICY IF EXISTS tenant_delete_mp_transferencia_reporte ON public.mp_transferencia_reporte;
DROP POLICY IF EXISTS tenant_select_mp_transferencia_movimiento ON public.mp_transferencia_movimiento;
DROP POLICY IF EXISTS tenant_insert_mp_transferencia_movimiento ON public.mp_transferencia_movimiento;
DROP POLICY IF EXISTS tenant_update_mp_transferencia_movimiento ON public.mp_transferencia_movimiento;
DROP POLICY IF EXISTS tenant_delete_mp_transferencia_movimiento ON public.mp_transferencia_movimiento;
DROP POLICY IF EXISTS tenant_select_mp_transferencia_verificacion ON public.mp_transferencia_verificacion;
DROP POLICY IF EXISTS tenant_insert_mp_transferencia_verificacion ON public.mp_transferencia_verificacion;
DROP POLICY IF EXISTS tenant_update_mp_transferencia_verificacion ON public.mp_transferencia_verificacion;
DROP POLICY IF EXISTS tenant_delete_mp_transferencia_verificacion ON public.mp_transferencia_verificacion;

CREATE POLICY tenant_select_mp_transferencia_reporte ON public.mp_transferencia_reporte FOR SELECT
  USING (tenant_id = public.current_tenant_id ());
CREATE POLICY tenant_insert_mp_transferencia_reporte ON public.mp_transferencia_reporte FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id ());
CREATE POLICY tenant_update_mp_transferencia_reporte ON public.mp_transferencia_reporte FOR UPDATE
  USING (tenant_id = public.current_tenant_id ())
  WITH CHECK (tenant_id = public.current_tenant_id ());
CREATE POLICY tenant_delete_mp_transferencia_reporte ON public.mp_transferencia_reporte FOR DELETE
  USING (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_select_mp_transferencia_movimiento ON public.mp_transferencia_movimiento FOR SELECT
  USING (tenant_id = public.current_tenant_id ());
CREATE POLICY tenant_insert_mp_transferencia_movimiento ON public.mp_transferencia_movimiento FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id ());
CREATE POLICY tenant_update_mp_transferencia_movimiento ON public.mp_transferencia_movimiento FOR UPDATE
  USING (tenant_id = public.current_tenant_id ())
  WITH CHECK (tenant_id = public.current_tenant_id ());
CREATE POLICY tenant_delete_mp_transferencia_movimiento ON public.mp_transferencia_movimiento FOR DELETE
  USING (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_select_mp_transferencia_verificacion ON public.mp_transferencia_verificacion FOR SELECT
  USING (tenant_id = public.current_tenant_id ());
CREATE POLICY tenant_insert_mp_transferencia_verificacion ON public.mp_transferencia_verificacion FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id ());
CREATE POLICY tenant_update_mp_transferencia_verificacion ON public.mp_transferencia_verificacion FOR UPDATE
  USING (tenant_id = public.current_tenant_id ())
  WITH CHECK (tenant_id = public.current_tenant_id ());
CREATE POLICY tenant_delete_mp_transferencia_verificacion ON public.mp_transferencia_verificacion FOR DELETE
  USING (tenant_id = public.current_tenant_id ());

GRANT ALL ON TABLE public.mp_transferencia_reporte TO anon;
GRANT ALL ON TABLE public.mp_transferencia_reporte TO authenticated;
GRANT ALL ON TABLE public.mp_transferencia_reporte TO service_role;
GRANT ALL ON TABLE public.mp_transferencia_movimiento TO anon;
GRANT ALL ON TABLE public.mp_transferencia_movimiento TO authenticated;
GRANT ALL ON TABLE public.mp_transferencia_movimiento TO service_role;
GRANT ALL ON TABLE public.mp_transferencia_verificacion TO anon;
GRANT ALL ON TABLE public.mp_transferencia_verificacion TO authenticated;
GRANT ALL ON TABLE public.mp_transferencia_verificacion TO service_role;

COMMENT ON TABLE public.mp_transferencia_reporte IS
  'Reportes de Todas las transacciones de Mercado Pago usados para conciliar transferencias CVU/alias en POS.';
COMMENT ON TABLE public.mp_transferencia_movimiento IS
  'Movimientos positivos importados del reporte Mercado Pago, normalizados para matching por monto y fecha.';
COMMENT ON TABLE public.mp_transferencia_verificacion IS
  'Reserva/verificacion de un movimiento MP contra una venta POS. Impide reutilizar el mismo movimiento.';

