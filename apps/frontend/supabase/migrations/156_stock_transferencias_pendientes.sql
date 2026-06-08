-- Transferencias de stock con recepcion pendiente.
-- El envio descuenta stock del origen; el destino debe aceptar para registrar la entrada.

CREATE TABLE IF NOT EXISTS public.stock_transferencia_sucursal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  producto_id UUID NOT NULL REFERENCES public.producto (id) ON DELETE RESTRICT,
  producto_variante_id UUID NULL REFERENCES public.producto_variante (id) ON DELETE RESTRICT,
  sucursal_origen_id UUID NOT NULL REFERENCES public.sucursal (id) ON DELETE RESTRICT,
  sucursal_destino_id UUID NOT NULL REFERENCES public.sucursal (id) ON DELETE RESTRICT,
  cantidad NUMERIC(12, 3) NOT NULL,
  motivo TEXT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  usuario_envio_id UUID NULL REFERENCES public.usuario (id) ON DELETE SET NULL,
  usuario_recepcion_id UUID NULL REFERENCES public.usuario (id) ON DELETE SET NULL,
  movimiento_salida_id UUID NULL REFERENCES public.movimiento (id) ON DELETE SET NULL,
  movimiento_entrada_id UUID NULL REFERENCES public.movimiento (id) ON DELETE SET NULL,
  deposito_destino_existia BOOLEAN NOT NULL DEFAULT false,
  deposito_destino_creado BOOLEAN NOT NULL DEFAULT false,
  enviado_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  recibido_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_stock_transferencia_cantidad_pos CHECK (cantidad > 0),
  CONSTRAINT chk_stock_transferencia_sucursales_distintas CHECK (sucursal_origen_id <> sucursal_destino_id),
  CONSTRAINT chk_stock_transferencia_estado CHECK (estado IN ('pendiente', 'recibida', 'cancelada'))
);

COMMENT ON TABLE public.stock_transferencia_sucursal IS
  'Transferencias de stock entre sucursales. La salida se registra al enviar; la entrada se registra cuando destino acepta la recepcion.';

CREATE INDEX IF NOT EXISTS idx_stock_transferencia_tenant_estado
  ON public.stock_transferencia_sucursal (tenant_id, estado, enviado_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_transferencia_destino_pendiente
  ON public.stock_transferencia_sucursal (tenant_id, sucursal_destino_id, enviado_at DESC)
  WHERE estado = 'pendiente';

CREATE INDEX IF NOT EXISTS idx_stock_transferencia_origen
  ON public.stock_transferencia_sucursal (tenant_id, sucursal_origen_id, enviado_at DESC);

DROP TRIGGER IF EXISTS set_stock_transferencia_updated_at ON public.stock_transferencia_sucursal;
CREATE TRIGGER set_stock_transferencia_updated_at
  BEFORE UPDATE ON public.stock_transferencia_sucursal
  FOR EACH ROW EXECUTE FUNCTION public.moddatetime('updated_at');

ALTER TABLE public.stock_transferencia_sucursal ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select_stock_transferencia ON public.stock_transferencia_sucursal;
CREATE POLICY tenant_select_stock_transferencia
  ON public.stock_transferencia_sucursal FOR SELECT
  USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_insert_stock_transferencia ON public.stock_transferencia_sucursal;
CREATE POLICY tenant_insert_stock_transferencia
  ON public.stock_transferencia_sucursal FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_update_stock_transferencia ON public.stock_transferencia_sucursal;
CREATE POLICY tenant_update_stock_transferencia
  ON public.stock_transferencia_sucursal FOR UPDATE
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

GRANT ALL ON TABLE public.stock_transferencia_sucursal TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crear_transferencia_stock_pendiente(
  p_tenant_id                 UUID,
  p_producto_id               UUID,
  p_sucursal_origen_id        UUID,
  p_sucursal_destino_id       UUID,
  p_cantidad                  NUMERIC(12, 3),
  p_motivo                    TEXT DEFAULT NULL,
  p_usuario_id                UUID DEFAULT NULL,
  p_producto_variante_id      UUID DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transfer_id UUID;
  m_sal public.movimiento;
  n_o TEXT;
  n_d TEXT;
  v_mot_sal TEXT;
  v_usa_variantes BOOLEAN;
  v_var_etiqueta TEXT;
  v_dest_exists_before BOOLEAN;
BEGIN
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a cero';
  END IF;

  IF p_sucursal_origen_id IS NULL OR p_sucursal_destino_id IS NULL THEN
    RAISE EXCEPTION 'Sucursal de origen y destino son obligatorias';
  END IF;

  IF p_sucursal_origen_id = p_sucursal_destino_id THEN
    RAISE EXCEPTION 'Origen y destino deben ser sucursales distintas';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.sucursal s
    WHERE s.id = p_sucursal_origen_id
      AND s.tenant_id = p_tenant_id
      AND s.activa = true
  ) THEN
    RAISE EXCEPTION 'Sucursal de origen no encontrada o inactiva';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.sucursal s
    WHERE s.id = p_sucursal_destino_id
      AND s.tenant_id = p_tenant_id
      AND s.activa = true
  ) THEN
    RAISE EXCEPTION 'Sucursal de destino no encontrada o inactiva';
  END IF;

  SELECT p.usa_variantes INTO v_usa_variantes
  FROM public.producto p
  WHERE p.id = p_producto_id
    AND p.tenant_id = p_tenant_id
    AND p.activo = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado o inactivo';
  END IF;

  IF v_usa_variantes AND p_producto_variante_id IS NULL THEN
    RAISE EXCEPTION 'Este producto usa variantes. Selecciona una variante para transferir stock.';
  END IF;

  IF NOT v_usa_variantes AND p_producto_variante_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este producto no usa variantes';
  END IF;

  IF p_producto_variante_id IS NOT NULL THEN
    SELECT public.producto_variante_etiqueta(v.atributos, v.etiqueta)
      INTO v_var_etiqueta
    FROM public.producto_variante v
    WHERE v.id = p_producto_variante_id
      AND v.producto_id = p_producto_id
      AND v.tenant_id = p_tenant_id
      AND v.activo = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Variante no encontrada o inactiva';
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(
      p_tenant_id::text
      || p_producto_id::text
      || COALESCE(p_producto_variante_id::text, '')
      || LEAST(p_sucursal_origen_id, p_sucursal_destino_id)::text
      || GREATEST(p_sucursal_origen_id, p_sucursal_destino_id)::text
    )
  );

  SELECT s.nombre INTO n_o FROM public.sucursal s WHERE s.id = p_sucursal_origen_id;
  SELECT s.nombre INTO n_d FROM public.sucursal s WHERE s.id = p_sucursal_destino_id;

  IF p_producto_variante_id IS NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.stock_sucursal ss
      WHERE ss.tenant_id = p_tenant_id
        AND ss.producto_id = p_producto_id
        AND ss.sucursal_id = p_sucursal_destino_id
    ) INTO v_dest_exists_before;
  ELSE
    SELECT EXISTS (
      SELECT 1
      FROM public.producto_variante_stock_sucursal ss
      WHERE ss.tenant_id = p_tenant_id
        AND ss.producto_id = p_producto_id
        AND ss.variante_id = p_producto_variante_id
        AND ss.sucursal_id = p_sucursal_destino_id
    ) INTO v_dest_exists_before;
  END IF;

  v_transfer_id := gen_random_uuid();
  v_mot_sal := 'Transferencia enviada a ' || COALESCE(n_d, '(sucursal)') || ' (pendiente de recepcion)'
    || COALESCE(' - ' || NULLIF(btrim(COALESCE(p_motivo, '')), ''), '');

  IF p_producto_variante_id IS NULL THEN
    SELECT * INTO m_sal FROM public.registrar_movimiento(
      p_tenant_id,
      p_producto_id,
      p_sucursal_origen_id,
      'salida'::public.tipo_movimiento,
      p_cantidad,
      v_mot_sal,
      'transferencia_sucursal'::public.referencia_tipo,
      v_transfer_id,
      p_usuario_id,
      false
    );
  ELSE
    SELECT * INTO m_sal FROM public.registrar_movimiento_variante(
      p_tenant_id,
      p_producto_id,
      p_producto_variante_id,
      p_sucursal_origen_id,
      'salida'::public.tipo_movimiento,
      p_cantidad,
      v_mot_sal,
      'transferencia_sucursal'::public.referencia_tipo,
      v_transfer_id,
      p_usuario_id,
      false
    );
  END IF;

  INSERT INTO public.stock_transferencia_sucursal (
    id, tenant_id, producto_id, producto_variante_id,
    sucursal_origen_id, sucursal_destino_id, cantidad, motivo,
    estado, usuario_envio_id, movimiento_salida_id,
    deposito_destino_existia, deposito_destino_creado
  ) VALUES (
    v_transfer_id, p_tenant_id, p_producto_id, p_producto_variante_id,
    p_sucursal_origen_id, p_sucursal_destino_id, p_cantidad, NULLIF(btrim(COALESCE(p_motivo, '')), ''),
    'pendiente', p_usuario_id, m_sal.id,
    v_dest_exists_before, false
  );

  RETURN jsonb_build_object(
    'transfer_id', v_transfer_id,
    'estado', 'pendiente',
    'producto_id', p_producto_id,
    'producto_variante_id', p_producto_variante_id,
    'producto_variante_etiqueta', v_var_etiqueta,
    'sucursal_origen_id', p_sucursal_origen_id,
    'sucursal_destino_id', p_sucursal_destino_id,
    'cantidad', p_cantidad,
    'movimiento_salida', to_jsonb(m_sal),
    'deposito_destino_existia', v_dest_exists_before,
    'deposito_destino_creado', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.aceptar_transferencia_stock_sucursal(
  p_tenant_id            UUID,
  p_transferencia_id     UUID,
  p_usuario_id           UUID DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_t public.stock_transferencia_sucursal%ROWTYPE;
  m_ent public.movimiento;
  n_o TEXT;
  n_d TEXT;
  v_mot_ent TEXT;
  v_dest_exists_before BOOLEAN;
BEGIN
  SELECT * INTO v_t
  FROM public.stock_transferencia_sucursal t
  WHERE t.id = p_transferencia_id
    AND t.tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transferencia no encontrada';
  END IF;

  IF v_t.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'La transferencia ya no esta pendiente';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.sucursal s
    WHERE s.id = v_t.sucursal_destino_id
      AND s.tenant_id = p_tenant_id
      AND s.activa = true
  ) THEN
    RAISE EXCEPTION 'Sucursal de destino no encontrada o inactiva';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(
      p_tenant_id::text
      || v_t.producto_id::text
      || COALESCE(v_t.producto_variante_id::text, '')
      || LEAST(v_t.sucursal_origen_id, v_t.sucursal_destino_id)::text
      || GREATEST(v_t.sucursal_origen_id, v_t.sucursal_destino_id)::text
    )
  );

  SELECT s.nombre INTO n_o FROM public.sucursal s WHERE s.id = v_t.sucursal_origen_id;
  SELECT s.nombre INTO n_d FROM public.sucursal s WHERE s.id = v_t.sucursal_destino_id;

  IF v_t.producto_variante_id IS NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.stock_sucursal ss
      WHERE ss.tenant_id = p_tenant_id
        AND ss.producto_id = v_t.producto_id
        AND ss.sucursal_id = v_t.sucursal_destino_id
    ) INTO v_dest_exists_before;
  ELSE
    SELECT EXISTS (
      SELECT 1
      FROM public.producto_variante_stock_sucursal ss
      WHERE ss.tenant_id = p_tenant_id
        AND ss.producto_id = v_t.producto_id
        AND ss.variante_id = v_t.producto_variante_id
        AND ss.sucursal_id = v_t.sucursal_destino_id
    ) INTO v_dest_exists_before;
  END IF;

  v_mot_ent := 'Recepcion de transferencia desde ' || COALESCE(n_o, '(sucursal)')
    || COALESCE(' - ' || NULLIF(btrim(COALESCE(v_t.motivo, '')), ''), '');

  IF v_t.producto_variante_id IS NULL THEN
    SELECT * INTO m_ent FROM public.registrar_movimiento(
      p_tenant_id,
      v_t.producto_id,
      v_t.sucursal_destino_id,
      'entrada'::public.tipo_movimiento,
      v_t.cantidad,
      v_mot_ent,
      'transferencia_sucursal'::public.referencia_tipo,
      v_t.id,
      p_usuario_id,
      false
    );
  ELSE
    SELECT * INTO m_ent FROM public.registrar_movimiento_variante(
      p_tenant_id,
      v_t.producto_id,
      v_t.producto_variante_id,
      v_t.sucursal_destino_id,
      'entrada'::public.tipo_movimiento,
      v_t.cantidad,
      v_mot_ent,
      'transferencia_sucursal'::public.referencia_tipo,
      v_t.id,
      p_usuario_id,
      false
    );
  END IF;

  UPDATE public.stock_transferencia_sucursal
  SET estado = 'recibida',
      usuario_recepcion_id = p_usuario_id,
      movimiento_entrada_id = m_ent.id,
      deposito_destino_creado = NOT v_dest_exists_before,
      recibido_at = now()
  WHERE id = v_t.id;

  RETURN jsonb_build_object(
    'transfer_id', v_t.id,
    'estado', 'recibida',
    'sucursal_origen_id', v_t.sucursal_origen_id,
    'sucursal_destino_id', v_t.sucursal_destino_id,
    'sucursal_destino_nombre', n_d,
    'cantidad', v_t.cantidad,
    'movimiento_entrada', to_jsonb(m_ent),
    'deposito_destino_creado', NOT v_dest_exists_before
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.crear_transferencia_stock_pendiente(
  uuid, uuid, uuid, uuid, numeric, text, uuid, uuid
) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.aceptar_transferencia_stock_sucursal(
  uuid, uuid, uuid
) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
