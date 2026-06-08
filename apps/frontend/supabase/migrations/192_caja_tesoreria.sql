-- Caja interna / tesorería: ledger de efectivo y cartera de cheques, pagos a proveedores.

-- ═══ Tipos ═══

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'caja_tesoreria_movimiento_tipo') THEN
    CREATE TYPE public.caja_tesoreria_movimiento_tipo AS ENUM (
      'ingreso_efectivo',
      'egreso_efectivo',
      'ingreso_cheque',
      'egreso_cheque',
      'pago_proveedor',
      'ajuste',
      'transferencia_desde_caja'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'caja_tesoreria_cheque_estado') THEN
    CREATE TYPE public.caja_tesoreria_cheque_estado AS ENUM (
      'en_cartera',
      'depositado',
      'entregado',
      'rechazado'
    );
  END IF;
END $$;

-- ═══ Tablas ═══

CREATE TABLE IF NOT EXISTS public.caja_tesoreria (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  sucursal_id UUID REFERENCES public.sucursal (id) ON DELETE CASCADE,
  nombre TEXT NOT NULL DEFAULT 'Caja interna',
  activa BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_caja_tesoreria_nombre_not_blank CHECK (btrim(nombre) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS uk_caja_tesoreria_tenant_central
  ON public.caja_tesoreria (tenant_id)
  WHERE sucursal_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uk_caja_tesoreria_tenant_sucursal
  ON public.caja_tesoreria (tenant_id, sucursal_id)
  WHERE sucursal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_caja_tesoreria_tenant
  ON public.caja_tesoreria (tenant_id);

CREATE INDEX IF NOT EXISTS idx_caja_tesoreria_sucursal
  ON public.caja_tesoreria (sucursal_id)
  WHERE sucursal_id IS NOT NULL;

DROP TRIGGER IF EXISTS set_caja_tesoreria_updated_at ON public.caja_tesoreria;
CREATE TRIGGER set_caja_tesoreria_updated_at
  BEFORE UPDATE ON public.caja_tesoreria
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime (updated_at);

COMMENT ON TABLE public.caja_tesoreria IS
  'Caja interna / tesorería del tenant o sucursal. Separada de cajas POS.';

CREATE TABLE IF NOT EXISTS public.caja_tesoreria_movimiento (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  caja_tesoreria_id UUID NOT NULL REFERENCES public.caja_tesoreria (id) ON DELETE RESTRICT,
  tipo public.caja_tesoreria_movimiento_tipo NOT NULL,
  monto NUMERIC(14, 2) NOT NULL,
  es_ingreso BOOLEAN NOT NULL,
  cierre_z_id UUID REFERENCES public.cierre_z (id) ON DELETE SET NULL,
  caja_id UUID REFERENCES public.caja (id) ON DELETE SET NULL,
  pago_id UUID REFERENCES public.pago (id) ON DELETE SET NULL,
  cheque_id UUID,
  proveedor_id UUID REFERENCES public.proveedor (id) ON DELETE SET NULL,
  notas TEXT,
  usuario_id UUID REFERENCES public.usuario (id) ON DELETE SET NULL,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_caja_tesoreria_mov_monto_pos CHECK (monto > 0)
);

CREATE INDEX IF NOT EXISTS idx_caja_tesoreria_mov_caja
  ON public.caja_tesoreria_movimiento (caja_tesoreria_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_caja_tesoreria_mov_tenant_fecha
  ON public.caja_tesoreria_movimiento (tenant_id, fecha DESC);

CREATE INDEX IF NOT EXISTS idx_caja_tesoreria_mov_pago
  ON public.caja_tesoreria_movimiento (pago_id)
  WHERE pago_id IS NOT NULL;

COMMENT ON TABLE public.caja_tesoreria_movimiento IS
  'Ledger inmutable de movimientos de tesorería (efectivo y referencias a cheques).';

CREATE TABLE IF NOT EXISTS public.caja_tesoreria_cheque (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  caja_tesoreria_id UUID NOT NULL REFERENCES public.caja_tesoreria (id) ON DELETE RESTRICT,
  numero TEXT NOT NULL,
  banco TEXT NOT NULL,
  titular TEXT,
  fecha_emision DATE,
  fecha_cobro DATE,
  monto NUMERIC(14, 2) NOT NULL,
  estado public.caja_tesoreria_cheque_estado NOT NULL DEFAULT 'en_cartera',
  movimiento_ingreso_id UUID NOT NULL REFERENCES public.caja_tesoreria_movimiento (id) ON DELETE RESTRICT,
  movimiento_egreso_id UUID REFERENCES public.caja_tesoreria_movimiento (id) ON DELETE SET NULL,
  pago_id UUID REFERENCES public.pago (id) ON DELETE SET NULL,
  notas TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_caja_tesoreria_cheque_monto_pos CHECK (monto > 0),
  CONSTRAINT chk_caja_tesoreria_cheque_numero_not_blank CHECK (btrim(numero) <> ''),
  CONSTRAINT chk_caja_tesoreria_cheque_banco_not_blank CHECK (btrim(banco) <> '')
);

ALTER TABLE public.caja_tesoreria_movimiento
  ADD CONSTRAINT fk_caja_tesoreria_mov_cheque
  FOREIGN KEY (cheque_id) REFERENCES public.caja_tesoreria_cheque (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_caja_tesoreria_cheque_caja_estado
  ON public.caja_tesoreria_cheque (caja_tesoreria_id, estado);

DROP TRIGGER IF EXISTS set_caja_tesoreria_cheque_updated_at ON public.caja_tesoreria_cheque;
CREATE TRIGGER set_caja_tesoreria_cheque_updated_at
  BEFORE UPDATE ON public.caja_tesoreria_cheque
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime (updated_at);

COMMENT ON TABLE public.caja_tesoreria_cheque IS
  'Cartera de cheques físicos en tesorería.';

-- ═══ RLS ═══

ALTER TABLE public.caja_tesoreria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.caja_tesoreria_movimiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.caja_tesoreria_cheque ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_select_caja_tesoreria ON public.caja_tesoreria FOR SELECT
  USING (tenant_id = public.current_tenant_id ());
CREATE POLICY tenant_insert_caja_tesoreria ON public.caja_tesoreria FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id ());
CREATE POLICY tenant_update_caja_tesoreria ON public.caja_tesoreria FOR UPDATE
  USING (tenant_id = public.current_tenant_id ())
  WITH CHECK (tenant_id = public.current_tenant_id ());
CREATE POLICY tenant_delete_caja_tesoreria ON public.caja_tesoreria FOR DELETE
  USING (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_select_caja_tesoreria_mov ON public.caja_tesoreria_movimiento FOR SELECT
  USING (tenant_id = public.current_tenant_id ());
CREATE POLICY tenant_insert_caja_tesoreria_mov ON public.caja_tesoreria_movimiento FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_select_caja_tesoreria_cheque ON public.caja_tesoreria_cheque FOR SELECT
  USING (tenant_id = public.current_tenant_id ());
CREATE POLICY tenant_insert_caja_tesoreria_cheque ON public.caja_tesoreria_cheque FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id ());
CREATE POLICY tenant_update_caja_tesoreria_cheque ON public.caja_tesoreria_cheque FOR UPDATE
  USING (tenant_id = public.current_tenant_id ())
  WITH CHECK (tenant_id = public.current_tenant_id ());

-- ═══ Helpers ═══

CREATE OR REPLACE FUNCTION public.saldo_efectivo_caja_tesoreria(p_caja_tesoreria_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    SUM(CASE WHEN es_ingreso THEN monto ELSE -monto END),
    0
  )
  FROM public.caja_tesoreria_movimiento
  WHERE caja_tesoreria_id = p_caja_tesoreria_id
    AND tipo IN (
      'ingreso_efectivo',
      'egreso_efectivo',
      'pago_proveedor',
      'ajuste',
      'transferencia_desde_caja'
    );
$$;

COMMENT ON FUNCTION public.saldo_efectivo_caja_tesoreria(UUID) IS
  'Saldo de efectivo en tesorería (excluye cartera de cheques).';

-- ═══ RPC: ingreso efectivo ═══

CREATE OR REPLACE FUNCTION public.registrar_ingreso_efectivo_tesoreria(
  p_tenant_id UUID,
  p_caja_tesoreria_id UUID,
  p_monto NUMERIC,
  p_notas TEXT DEFAULT NULL,
  p_usuario_id UUID DEFAULT NULL,
  p_fecha DATE DEFAULT NULL
)
RETURNS public.caja_tesoreria_movimiento
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caja public.caja_tesoreria;
  v_mov public.caja_tesoreria_movimiento;
  v_fecha DATE := COALESCE(p_fecha, CURRENT_DATE);
BEGIN
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a cero';
  END IF;

  SELECT * INTO v_caja
  FROM public.caja_tesoreria
  WHERE id = p_caja_tesoreria_id AND tenant_id = p_tenant_id AND activa = true;

  IF v_caja IS NULL THEN
    RAISE EXCEPTION 'Caja de tesorería no encontrada o inactiva';
  END IF;

  INSERT INTO public.caja_tesoreria_movimiento (
    tenant_id, caja_tesoreria_id, tipo, monto, es_ingreso, notas, usuario_id, fecha
  ) VALUES (
    p_tenant_id, p_caja_tesoreria_id, 'ingreso_efectivo', p_monto, true, p_notas, p_usuario_id, v_fecha
  )
  RETURNING * INTO v_mov;

  RETURN v_mov;
END;
$$;

-- ═══ RPC: registrar cheque ═══

CREATE OR REPLACE FUNCTION public.registrar_cheque_tesoreria(
  p_tenant_id UUID,
  p_caja_tesoreria_id UUID,
  p_numero TEXT,
  p_banco TEXT,
  p_titular TEXT DEFAULT NULL,
  p_fecha_emision DATE DEFAULT NULL,
  p_fecha_cobro DATE DEFAULT NULL,
  p_monto NUMERIC DEFAULT NULL,
  p_notas TEXT DEFAULT NULL,
  p_usuario_id UUID DEFAULT NULL,
  p_fecha DATE DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caja public.caja_tesoreria;
  v_mov public.caja_tesoreria_movimiento;
  v_cheque public.caja_tesoreria_cheque;
  v_fecha DATE := COALESCE(p_fecha, CURRENT_DATE);
BEGIN
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto del cheque debe ser mayor a cero';
  END IF;
  IF p_numero IS NULL OR btrim(p_numero) = '' THEN
    RAISE EXCEPTION 'El número de cheque es obligatorio';
  END IF;
  IF p_banco IS NULL OR btrim(p_banco) = '' THEN
    RAISE EXCEPTION 'El banco es obligatorio';
  END IF;

  SELECT * INTO v_caja
  FROM public.caja_tesoreria
  WHERE id = p_caja_tesoreria_id AND tenant_id = p_tenant_id AND activa = true;

  IF v_caja IS NULL THEN
    RAISE EXCEPTION 'Caja de tesorería no encontrada o inactiva';
  END IF;

  INSERT INTO public.caja_tesoreria_movimiento (
    tenant_id, caja_tesoreria_id, tipo, monto, es_ingreso, notas, usuario_id, fecha
  ) VALUES (
    p_tenant_id, p_caja_tesoreria_id, 'ingreso_cheque', p_monto, true, p_notas, p_usuario_id, v_fecha
  )
  RETURNING * INTO v_mov;

  INSERT INTO public.caja_tesoreria_cheque (
    tenant_id,
    caja_tesoreria_id,
    numero,
    banco,
    titular,
    fecha_emision,
    fecha_cobro,
    monto,
    estado,
    movimiento_ingreso_id,
    notas
  ) VALUES (
    p_tenant_id,
    p_caja_tesoreria_id,
    btrim(p_numero),
    btrim(p_banco),
    NULLIF(btrim(COALESCE(p_titular, '')), ''),
    p_fecha_emision,
    p_fecha_cobro,
    p_monto,
    'en_cartera',
    v_mov.id,
    p_notas
  )
  RETURNING * INTO v_cheque;

  UPDATE public.caja_tesoreria_movimiento
  SET cheque_id = v_cheque.id
  WHERE id = v_mov.id;

  RETURN jsonb_build_object(
    'movimiento_id', v_mov.id,
    'cheque_id', v_cheque.id
  );
END;
$$;

-- ═══ RPC: transferencia desde caja POS (manual, solo trazabilidad) ═══

CREATE OR REPLACE FUNCTION public.registrar_transferencia_desde_caja_tesoreria(
  p_tenant_id UUID,
  p_caja_tesoreria_id UUID,
  p_monto NUMERIC,
  p_cierre_z_id UUID DEFAULT NULL,
  p_caja_id UUID DEFAULT NULL,
  p_notas TEXT DEFAULT NULL,
  p_usuario_id UUID DEFAULT NULL,
  p_fecha DATE DEFAULT NULL
)
RETURNS public.caja_tesoreria_movimiento
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caja public.caja_tesoreria;
  v_mov public.caja_tesoreria_movimiento;
  v_fecha DATE := COALESCE(p_fecha, CURRENT_DATE);
BEGIN
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a cero';
  END IF;

  SELECT * INTO v_caja
  FROM public.caja_tesoreria
  WHERE id = p_caja_tesoreria_id AND tenant_id = p_tenant_id AND activa = true;

  IF v_caja IS NULL THEN
    RAISE EXCEPTION 'Caja de tesorería no encontrada o inactiva';
  END IF;

  IF p_cierre_z_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.cierre_z
      WHERE id = p_cierre_z_id AND tenant_id = p_tenant_id
    ) THEN
      RAISE EXCEPTION 'Cierre Z no encontrado';
    END IF;
  END IF;

  IF p_caja_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.caja
      WHERE id = p_caja_id AND tenant_id = p_tenant_id
    ) THEN
      RAISE EXCEPTION 'Caja POS no encontrada';
    END IF;
  END IF;

  INSERT INTO public.caja_tesoreria_movimiento (
    tenant_id,
    caja_tesoreria_id,
    tipo,
    monto,
    es_ingreso,
    cierre_z_id,
    caja_id,
    notas,
    usuario_id,
    fecha
  ) VALUES (
    p_tenant_id,
    p_caja_tesoreria_id,
    'transferencia_desde_caja',
    p_monto,
    true,
    p_cierre_z_id,
    p_caja_id,
    p_notas,
    p_usuario_id,
    v_fecha
  )
  RETURNING * INTO v_mov;

  RETURN v_mov;
END;
$$;

-- ═══ RPC: cambiar estado cheque (depositado / rechazado) ═══

CREATE OR REPLACE FUNCTION public.cambiar_estado_cheque_tesoreria(
  p_tenant_id UUID,
  p_cheque_id UUID,
  p_estado public.caja_tesoreria_cheque_estado,
  p_notas TEXT DEFAULT NULL,
  p_usuario_id UUID DEFAULT NULL
)
RETURNS public.caja_tesoreria_cheque
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cheque public.caja_tesoreria_cheque;
BEGIN
  IF p_estado NOT IN ('depositado', 'rechazado') THEN
    RAISE EXCEPTION 'Solo se puede cambiar a depositado o rechazado desde este RPC';
  END IF;

  SELECT * INTO v_cheque
  FROM public.caja_tesoreria_cheque
  WHERE id = p_cheque_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF v_cheque IS NULL THEN
    RAISE EXCEPTION 'Cheque no encontrado';
  END IF;

  IF v_cheque.estado <> 'en_cartera' THEN
    RAISE EXCEPTION 'Solo se puede cambiar el estado de cheques en cartera';
  END IF;

  UPDATE public.caja_tesoreria_cheque
  SET
    estado = p_estado,
    notas = COALESCE(p_notas, notas),
    updated_at = now()
  WHERE id = p_cheque_id
  RETURNING * INTO v_cheque;

  RETURN v_cheque;
END;
$$;

-- ═══ RPC: pago a proveedor desde tesorería ═══

CREATE OR REPLACE FUNCTION public.registrar_pago_proveedor_tesoreria(
  p_tenant_id UUID,
  p_caja_tesoreria_id UUID,
  p_proveedor_id UUID,
  p_monto NUMERIC,
  p_tipo_pago public.tipo_pago DEFAULT 'efectivo',
  p_cheque_id UUID DEFAULT NULL,
  p_pago_proveedor_factura_id UUID DEFAULT NULL,
  p_notas TEXT DEFAULT NULL,
  p_usuario_id UUID DEFAULT NULL,
  p_fecha DATE DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caja public.caja_tesoreria;
  v_saldo NUMERIC;
  v_cheque public.caja_tesoreria_cheque;
  v_pago_result jsonb;
  v_pago_id UUID;
  v_mov public.caja_tesoreria_movimiento;
  v_fecha DATE := COALESCE(p_fecha, CURRENT_DATE);
  v_tipo_mov public.caja_tesoreria_movimiento_tipo;
BEGIN
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a cero';
  END IF;

  SELECT * INTO v_caja
  FROM public.caja_tesoreria
  WHERE id = p_caja_tesoreria_id AND tenant_id = p_tenant_id AND activa = true;

  IF v_caja IS NULL THEN
    RAISE EXCEPTION 'Caja de tesorería no encontrada o inactiva';
  END IF;

  IF p_tipo_pago = 'efectivo' THEN
    v_saldo := public.saldo_efectivo_caja_tesoreria(p_caja_tesoreria_id);
    IF v_saldo + 0.000001 < p_monto THEN
      RAISE EXCEPTION 'Saldo de efectivo insuficiente en tesorería (disponible: %)', v_saldo;
    END IF;
    v_tipo_mov := 'pago_proveedor';
  ELSIF p_tipo_pago = 'cheque' THEN
    IF p_cheque_id IS NULL THEN
      RAISE EXCEPTION 'Debe indicar el cheque a entregar';
    END IF;
    SELECT * INTO v_cheque
    FROM public.caja_tesoreria_cheque
    WHERE id = p_cheque_id
      AND tenant_id = p_tenant_id
      AND caja_tesoreria_id = p_caja_tesoreria_id
    FOR UPDATE;

    IF v_cheque IS NULL THEN
      RAISE EXCEPTION 'Cheque no encontrado en esta tesorería';
    END IF;
    IF v_cheque.estado <> 'en_cartera' THEN
      RAISE EXCEPTION 'El cheque no está en cartera';
    END IF;
    IF ABS(v_cheque.monto - p_monto) > 0.01 THEN
      RAISE EXCEPTION 'El monto del pago debe coincidir con el monto del cheque';
    END IF;
    v_tipo_mov := 'egreso_cheque';
  ELSE
    RAISE EXCEPTION 'Solo se admiten pagos en efectivo o cheque desde tesorería';
  END IF;

  IF p_pago_proveedor_factura_id IS NOT NULL THEN
    v_pago_result := public.registrar_pago_proveedor(
      p_pago_proveedor_factura_id,
      p_monto,
      p_tipo_pago,
      p_notas,
      p_usuario_id,
      v_fecha
    );
    v_pago_id := (v_pago_result->>'pago_cuenta_corriente_id')::UUID;
  ELSE
    v_pago_id := (
      public.registrar_pago_cuenta_proveedor(
        p_tenant_id,
        p_proveedor_id,
        p_monto,
        p_tipo_pago,
        NULL,
        NULL,
        p_notas,
        p_usuario_id,
        v_fecha
      )
    ).id;
  END IF;

  INSERT INTO public.caja_tesoreria_movimiento (
    tenant_id,
    caja_tesoreria_id,
    tipo,
    monto,
    es_ingreso,
    pago_id,
    cheque_id,
    proveedor_id,
    notas,
    usuario_id,
    fecha
  ) VALUES (
    p_tenant_id,
    p_caja_tesoreria_id,
    v_tipo_mov,
    p_monto,
    false,
    v_pago_id,
    p_cheque_id,
    p_proveedor_id,
    p_notas,
    p_usuario_id,
    v_fecha
  )
  RETURNING * INTO v_mov;

  IF p_tipo_pago = 'cheque' AND p_cheque_id IS NOT NULL THEN
    UPDATE public.caja_tesoreria_cheque
    SET
      estado = 'entregado',
      movimiento_egreso_id = v_mov.id,
      pago_id = v_pago_id,
      updated_at = now()
    WHERE id = p_cheque_id;
  END IF;

  RETURN jsonb_build_object(
    'movimiento_id', v_mov.id,
    'pago_id', v_pago_id,
    'pago_proveedor', v_pago_result
  );
END;
$$;

-- ═══ RPC: revertir movimiento tesorería por pago (compensación) ═══

CREATE OR REPLACE FUNCTION public.revertir_movimiento_tesoreria_por_pago(
  p_tenant_id UUID,
  p_pago_id UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mov public.caja_tesoreria_movimiento;
  v_cheque public.caja_tesoreria_cheque;
  v_comp public.caja_tesoreria_movimiento;
  v_comp_id UUID := NULL;
BEGIN
  SELECT * INTO v_mov
  FROM public.caja_tesoreria_movimiento
  WHERE tenant_id = p_tenant_id
    AND pago_id = p_pago_id
    AND es_ingreso = false
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_mov IS NULL THEN
    RETURN jsonb_build_object('revertido', false, 'motivo', 'sin_movimiento_tesoreria');
  END IF;

  IF v_mov.cheque_id IS NOT NULL THEN
    SELECT * INTO v_cheque
    FROM public.caja_tesoreria_cheque
    WHERE id = v_mov.cheque_id AND tenant_id = p_tenant_id
    FOR UPDATE;

    IF v_cheque IS NULL THEN
      RAISE EXCEPTION 'Cheque asociado no encontrado';
    END IF;
    IF v_cheque.estado = 'depositado' THEN
      RAISE EXCEPTION 'No se puede revertir: el cheque ya fue depositado';
    END IF;

    UPDATE public.caja_tesoreria_cheque
    SET
      estado = 'en_cartera',
      movimiento_egreso_id = NULL,
      pago_id = NULL,
      updated_at = now()
    WHERE id = v_cheque.id;
  ELSIF v_mov.tipo IN ('pago_proveedor', 'egreso_efectivo') THEN
    INSERT INTO public.caja_tesoreria_movimiento (
      tenant_id,
      caja_tesoreria_id,
      tipo,
      monto,
      es_ingreso,
      pago_id,
      proveedor_id,
      notas,
      usuario_id,
      fecha
    ) VALUES (
      p_tenant_id,
      v_mov.caja_tesoreria_id,
      'ajuste',
      v_mov.monto,
      true,
      p_pago_id,
      v_mov.proveedor_id,
      'Reversión de pago a proveedor',
      v_mov.usuario_id,
      CURRENT_DATE
    )
    RETURNING * INTO v_comp;
    v_comp_id := v_comp.id;
  END IF;

  RETURN jsonb_build_object(
    'revertido', true,
    'movimiento_id', v_mov.id,
    'compensacion_id', v_comp_id
  );
END;
$$;

-- ═══ RPC: provisionar cajas según alcance ═══

CREATE OR REPLACE FUNCTION public.provisionar_cajas_tesoreria(
  p_tenant_id UUID,
  p_alcance TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT := 0;
  v_sucursal RECORD;
BEGIN
  IF p_alcance NOT IN ('tenant', 'sucursal') THEN
    RAISE EXCEPTION 'Alcance inválido: use tenant o sucursal';
  END IF;

  IF p_alcance = 'tenant' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.caja_tesoreria
      WHERE tenant_id = p_tenant_id AND sucursal_id IS NULL
    ) THEN
      INSERT INTO public.caja_tesoreria (tenant_id, sucursal_id, nombre, activa)
      VALUES (p_tenant_id, NULL, 'Caja interna central', true);
    ELSE
      UPDATE public.caja_tesoreria
      SET activa = true, updated_at = now()
      WHERE tenant_id = p_tenant_id AND sucursal_id IS NULL;
    END IF;

    UPDATE public.caja_tesoreria
    SET activa = false, updated_at = now()
    WHERE tenant_id = p_tenant_id AND sucursal_id IS NOT NULL;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN jsonb_build_object('alcance', 'tenant', 'desactivadas_sucursales', v_count);
  END IF;

  UPDATE public.caja_tesoreria
  SET activa = false, updated_at = now()
  WHERE tenant_id = p_tenant_id AND sucursal_id IS NULL;

  FOR v_sucursal IN
    SELECT id, nombre FROM public.sucursal
    WHERE tenant_id = p_tenant_id AND activa = true
  LOOP
    INSERT INTO public.caja_tesoreria (tenant_id, sucursal_id, nombre, activa)
    VALUES (
      p_tenant_id,
      v_sucursal.id,
      'Caja interna — ' || v_sucursal.nombre,
      true
    )
    ON CONFLICT (tenant_id, sucursal_id) WHERE sucursal_id IS NOT NULL DO UPDATE
      SET activa = true, nombre = EXCLUDED.nombre, updated_at = now();

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('alcance', 'sucursal', 'sucursales_provisionadas', v_count);
END;
$$;

-- ═══ Permisos RBAC ═══

INSERT INTO public.permiso (clave, modulo, descripcion)
VALUES ('tesoreria.gestionar', 'tesoreria', 'Gestionar caja interna / tesorería')
ON CONFLICT (clave) DO NOTHING;

INSERT INTO public.rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
FROM public.rol r
JOIN public.permiso p ON p.clave = 'tesoreria.gestionar'
WHERE lower(r.slug) IN ('superadmin', 'admin')
ON CONFLICT (rol_id, permiso_id) DO NOTHING;

-- ═══ Grants ═══

REVOKE ALL ON FUNCTION public.saldo_efectivo_caja_tesoreria(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.saldo_efectivo_caja_tesoreria(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.registrar_ingreso_efectivo_tesoreria(UUID, UUID, NUMERIC, TEXT, UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_ingreso_efectivo_tesoreria(UUID, UUID, NUMERIC, TEXT, UUID, DATE)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.registrar_cheque_tesoreria(UUID, UUID, TEXT, TEXT, TEXT, DATE, DATE, NUMERIC, TEXT, UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_cheque_tesoreria(UUID, UUID, TEXT, TEXT, TEXT, DATE, DATE, NUMERIC, TEXT, UUID, DATE)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.registrar_transferencia_desde_caja_tesoreria(UUID, UUID, NUMERIC, UUID, UUID, TEXT, UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_transferencia_desde_caja_tesoreria(UUID, UUID, NUMERIC, UUID, UUID, TEXT, UUID, DATE)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.cambiar_estado_cheque_tesoreria(UUID, UUID, public.caja_tesoreria_cheque_estado, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cambiar_estado_cheque_tesoreria(UUID, UUID, public.caja_tesoreria_cheque_estado, TEXT, UUID)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.registrar_pago_proveedor_tesoreria(UUID, UUID, UUID, NUMERIC, public.tipo_pago, UUID, UUID, TEXT, UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_pago_proveedor_tesoreria(UUID, UUID, UUID, NUMERIC, public.tipo_pago, UUID, UUID, TEXT, UUID, DATE)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.revertir_movimiento_tesoreria_por_pago(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revertir_movimiento_tesoreria_por_pago(UUID, UUID)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.provisionar_cajas_tesoreria(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.provisionar_cajas_tesoreria(UUID, TEXT)
  TO authenticated, service_role;
