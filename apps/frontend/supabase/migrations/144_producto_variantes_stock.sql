-- Productos con variantes y stock paralelo por sucursal.
-- La migracion es aditiva: productos existentes quedan con usa_variantes=false.

ALTER TABLE public.producto
  ADD COLUMN IF NOT EXISTS usa_variantes BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.producto.usa_variantes IS
  'Si true, el producto padre es catalogo/modelo y el stock vendible vive en producto_variante_stock_sucursal.';

CREATE TABLE IF NOT EXISTS public.producto_variante (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  producto_id UUID NOT NULL REFERENCES public.producto (id) ON DELETE CASCADE,
  codigo TEXT NULL,
  codigo_barras VARCHAR(64) NULL,
  atributos JSONB NOT NULL DEFAULT '{}'::jsonb,
  etiqueta TEXT NULL,
  activo BOOLEAN NOT NULL DEFAULT true,
  orden INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_producto_variante_atributos_obj CHECK (jsonb_typeof(atributos) = 'object'),
  CONSTRAINT chk_producto_variante_codigo_not_blank CHECK (codigo IS NULL OR btrim(codigo) <> ''),
  CONSTRAINT chk_producto_variante_barcode_not_blank CHECK (codigo_barras IS NULL OR btrim(codigo_barras) <> '')
);

COMMENT ON TABLE public.producto_variante IS
  'Variantes vendibles de un producto padre. V1 usa atributos talle/color/material/medida y hereda precios del producto.';

CREATE INDEX IF NOT EXISTS idx_producto_variante_tenant_producto
  ON public.producto_variante (tenant_id, producto_id);

CREATE INDEX IF NOT EXISTS idx_producto_variante_tenant_barcode
  ON public.producto_variante (tenant_id, codigo_barras)
  WHERE codigo_barras IS NOT NULL AND activo = true;

CREATE UNIQUE INDEX IF NOT EXISTS ux_producto_variante_codigo_activa
  ON public.producto_variante (tenant_id, producto_id, lower(btrim(codigo)))
  WHERE codigo IS NOT NULL AND activo = true;

CREATE UNIQUE INDEX IF NOT EXISTS ux_producto_variante_barcode_activa
  ON public.producto_variante (tenant_id, codigo_barras)
  WHERE codigo_barras IS NOT NULL AND activo = true;

CREATE UNIQUE INDEX IF NOT EXISTS ux_producto_variante_atributos_activa
  ON public.producto_variante (tenant_id, producto_id, atributos)
  WHERE activo = true;

CREATE TABLE IF NOT EXISTS public.producto_variante_stock_sucursal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  producto_id UUID NOT NULL REFERENCES public.producto (id) ON DELETE CASCADE,
  variante_id UUID NOT NULL REFERENCES public.producto_variante (id) ON DELETE CASCADE,
  sucursal_id UUID NOT NULL REFERENCES public.sucursal (id) ON DELETE RESTRICT,
  stock_actual NUMERIC(12, 3) NOT NULL DEFAULT 0,
  stock_minimo NUMERIC(12, 3) NOT NULL DEFAULT 0,
  ubicacion TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ux_producto_variante_stock_sucursal UNIQUE (variante_id, sucursal_id),
  CONSTRAINT chk_producto_variante_stock_nonneg_min CHECK (stock_minimo >= 0)
);

COMMENT ON TABLE public.producto_variante_stock_sucursal IS
  'Stock por variante y sucursal. Es paralelo a stock_sucursal y solo aplica cuando producto.usa_variantes=true.';

CREATE INDEX IF NOT EXISTS idx_producto_variante_stock_tenant_producto
  ON public.producto_variante_stock_sucursal (tenant_id, producto_id);

CREATE INDEX IF NOT EXISTS idx_producto_variante_stock_sucursal
  ON public.producto_variante_stock_sucursal (tenant_id, sucursal_id, producto_id);

ALTER TABLE public.movimiento
  ADD COLUMN IF NOT EXISTS producto_variante_id UUID NULL REFERENCES public.producto_variante (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS producto_variante_etiqueta TEXT NULL;

ALTER TABLE public.comprobante_item
  ADD COLUMN IF NOT EXISTS producto_variante_id UUID NULL REFERENCES public.producto_variante (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS producto_variante_etiqueta TEXT NULL;

ALTER TABLE public.pedido_item
  ADD COLUMN IF NOT EXISTS producto_variante_id UUID NULL REFERENCES public.producto_variante (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS producto_variante_etiqueta TEXT NULL;

ALTER TABLE public.producto_lote_ingreso
  ADD COLUMN IF NOT EXISTS producto_variante_id UUID NULL REFERENCES public.producto_variante (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS producto_variante_etiqueta TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_movimiento_producto_variante
  ON public.movimiento (tenant_id, producto_variante_id)
  WHERE producto_variante_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_comprobante_item_producto_variante
  ON public.comprobante_item (producto_variante_id)
  WHERE producto_variante_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pedido_item_producto_variante
  ON public.pedido_item (producto_variante_id)
  WHERE producto_variante_id IS NOT NULL;

ALTER TABLE public.producto_promocion
  ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS producto_variante_id UUID NULL REFERENCES public.producto_variante (id) ON DELETE CASCADE;

UPDATE public.producto_promocion SET id = gen_random_uuid() WHERE id IS NULL;
ALTER TABLE public.producto_promocion ALTER COLUMN id SET NOT NULL;
ALTER TABLE public.producto_promocion DROP CONSTRAINT IF EXISTS producto_promocion_pkey;
ALTER TABLE public.producto_promocion ADD CONSTRAINT producto_promocion_pkey PRIMARY KEY (id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_producto_promocion_producto_total
  ON public.producto_promocion (promocion_id, producto_id)
  WHERE producto_variante_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_producto_promocion_variante
  ON public.producto_promocion (promocion_id, producto_id, producto_variante_id)
  WHERE producto_variante_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_producto_promocion_variante
  ON public.producto_promocion (tenant_id, producto_variante_id)
  WHERE producto_variante_id IS NOT NULL;

ALTER TABLE public.promocion_combo_item
  ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS producto_variante_id UUID NULL REFERENCES public.producto_variante (id) ON DELETE CASCADE;

UPDATE public.promocion_combo_item SET id = gen_random_uuid() WHERE id IS NULL;
ALTER TABLE public.promocion_combo_item ALTER COLUMN id SET NOT NULL;
ALTER TABLE public.promocion_combo_item DROP CONSTRAINT IF EXISTS promocion_combo_item_pkey;
ALTER TABLE public.promocion_combo_item ADD CONSTRAINT promocion_combo_item_pkey PRIMARY KEY (id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_promocion_combo_item_producto_total
  ON public.promocion_combo_item (promocion_id, producto_id)
  WHERE producto_variante_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_promocion_combo_item_variante
  ON public.promocion_combo_item (promocion_id, producto_id, producto_variante_id)
  WHERE producto_variante_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_promocion_combo_item_variante
  ON public.promocion_combo_item (tenant_id, producto_variante_id)
  WHERE producto_variante_id IS NOT NULL;

ALTER TABLE public.producto_variante ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.producto_variante_stock_sucursal ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select_producto_variante ON public.producto_variante;
CREATE POLICY tenant_select_producto_variante
  ON public.producto_variante FOR SELECT
  USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_insert_producto_variante ON public.producto_variante;
CREATE POLICY tenant_insert_producto_variante
  ON public.producto_variante FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_update_producto_variante ON public.producto_variante;
CREATE POLICY tenant_update_producto_variante
  ON public.producto_variante FOR UPDATE
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_delete_producto_variante ON public.producto_variante;
CREATE POLICY tenant_delete_producto_variante
  ON public.producto_variante FOR DELETE
  USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_select_producto_variante_stock ON public.producto_variante_stock_sucursal;
CREATE POLICY tenant_select_producto_variante_stock
  ON public.producto_variante_stock_sucursal FOR SELECT
  USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_insert_producto_variante_stock ON public.producto_variante_stock_sucursal;
CREATE POLICY tenant_insert_producto_variante_stock
  ON public.producto_variante_stock_sucursal FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_update_producto_variante_stock ON public.producto_variante_stock_sucursal;
CREATE POLICY tenant_update_producto_variante_stock
  ON public.producto_variante_stock_sucursal FOR UPDATE
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_delete_producto_variante_stock ON public.producto_variante_stock_sucursal;
CREATE POLICY tenant_delete_producto_variante_stock
  ON public.producto_variante_stock_sucursal FOR DELETE
  USING (tenant_id = public.current_tenant_id());

DROP TRIGGER IF EXISTS set_producto_variante_updated_at ON public.producto_variante;
CREATE TRIGGER set_producto_variante_updated_at
  BEFORE UPDATE ON public.producto_variante
  FOR EACH ROW EXECUTE FUNCTION public.moddatetime('updated_at');

DROP TRIGGER IF EXISTS set_producto_variante_stock_updated_at ON public.producto_variante_stock_sucursal;
CREATE TRIGGER set_producto_variante_stock_updated_at
  BEFORE UPDATE ON public.producto_variante_stock_sucursal
  FOR EACH ROW EXECUTE FUNCTION public.moddatetime('updated_at');

CREATE OR REPLACE FUNCTION public.producto_variante_etiqueta(
  p_atributos jsonb,
  p_etiqueta text DEFAULT NULL
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    NULLIF(btrim(p_etiqueta), ''),
    NULLIF(
      array_to_string(
        ARRAY[
          NULLIF(btrim(p_atributos->>'talle'), ''),
          NULLIF(btrim(p_atributos->>'color'), ''),
          NULLIF(btrim(p_atributos->>'material'), ''),
          NULLIF(btrim(p_atributos->>'medida'), '')
        ],
        ' / '
      ),
      ''
    ),
    'Variante'
  );
$$;

-- Proteger el camino legacy: un producto con variantes no puede mover stock del padre.
CREATE OR REPLACE FUNCTION public.registrar_movimiento(
  p_tenant_id                 UUID,
  p_producto_id               UUID,
  p_sucursal_id               UUID,
  p_tipo                      public.tipo_movimiento,
  p_cantidad                  NUMERIC(12, 3),
  p_motivo                    TEXT DEFAULT NULL,
  p_referencia_tipo           public.referencia_tipo DEFAULT NULL,
  p_referencia_id             UUID DEFAULT NULL,
  p_usuario_id                UUID DEFAULT NULL,
  p_permitir_stock_negativo   BOOLEAN DEFAULT FALSE,
  p_proveedor_id              UUID DEFAULT NULL
) RETURNS public.movimiento AS $$
DECLARE
  v_suc_producto    UUID;
  v_usa_variantes   BOOLEAN;
  v_stock_anterior  NUMERIC(12, 3);
  v_stock_posterior NUMERIC(12, 3);
  v_movimiento      public.movimiento;
BEGIN
  IF p_cantidad IS NULL THEN
    RAISE EXCEPTION 'La cantidad no puede ser nula';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.sucursal s
    WHERE s.id = p_sucursal_id
      AND s.tenant_id = p_tenant_id
      AND s.activa = true
  ) THEN
    RAISE EXCEPTION 'Sucursal invalida o inactiva para este negocio';
  END IF;

  SELECT p.sucursal_id, p.usa_variantes INTO v_suc_producto, v_usa_variantes
  FROM public.producto p
  WHERE p.id = p_producto_id AND p.tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado: %', p_producto_id;
  END IF;

  IF v_usa_variantes THEN
    RAISE EXCEPTION 'Este producto usa variantes. Selecciona una variante para mover stock.';
  END IF;

  IF v_suc_producto IS NULL THEN
    RAISE EXCEPTION 'Producto sin sucursal asignada';
  END IF;

  SELECT ss.stock_actual INTO v_stock_anterior
  FROM public.stock_sucursal ss
  WHERE ss.tenant_id = p_tenant_id
    AND ss.producto_id = p_producto_id
    AND ss.sucursal_id = p_sucursal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.stock_sucursal (tenant_id, producto_id, sucursal_id, stock_actual, stock_minimo, ubicacion)
    VALUES (p_tenant_id, p_producto_id, p_sucursal_id, 0, 0, NULL)
    ON CONFLICT (producto_id, sucursal_id) DO NOTHING;

    SELECT ss.stock_actual INTO v_stock_anterior
    FROM public.stock_sucursal ss
    WHERE ss.tenant_id = p_tenant_id
      AND ss.producto_id = p_producto_id
      AND ss.sucursal_id = p_sucursal_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'No se pudo inicializar stock_sucursal para el producto % en la sucursal %', p_producto_id, p_sucursal_id;
    END IF;
  END IF;

  CASE p_tipo
    WHEN 'entrada' THEN
      IF p_cantidad <= 0 THEN
        RAISE EXCEPTION 'La cantidad de entrada debe ser mayor a cero';
      END IF;
      v_stock_posterior := v_stock_anterior + p_cantidad;
    WHEN 'salida' THEN
      IF p_cantidad <= 0 THEN
        RAISE EXCEPTION 'La cantidad de salida debe ser mayor a cero';
      END IF;
      v_stock_posterior := v_stock_anterior - p_cantidad;
      IF NOT p_permitir_stock_negativo AND v_stock_posterior < 0 THEN
        RAISE EXCEPTION 'Stock insuficiente. Actual: %, solicitado: %',
          v_stock_anterior, p_cantidad;
      END IF;
    WHEN 'ajuste' THEN
      v_stock_posterior := p_cantidad;
    ELSE
      RAISE EXCEPTION 'Tipo de movimiento no soportado: %', p_tipo;
  END CASE;

  UPDATE public.stock_sucursal ss
  SET stock_actual = v_stock_posterior, updated_at = NOW()
  WHERE ss.tenant_id = p_tenant_id
    AND ss.producto_id = p_producto_id
    AND ss.sucursal_id = p_sucursal_id;

  INSERT INTO public.movimiento (
    tenant_id, sucursal_id, producto_id, tipo, cantidad, stock_anterior, stock_posterior,
    motivo, referencia_tipo, referencia_id, usuario_id, proveedor_id
  ) VALUES (
    p_tenant_id, p_sucursal_id, p_producto_id, p_tipo, p_cantidad, v_stock_anterior, v_stock_posterior,
    p_motivo, p_referencia_tipo, p_referencia_id, p_usuario_id, p_proveedor_id
  ) RETURNING * INTO v_movimiento;

  RETURN v_movimiento;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.registrar_movimiento_variante(
  p_tenant_id                 UUID,
  p_producto_id               UUID,
  p_producto_variante_id      UUID,
  p_sucursal_id               UUID,
  p_tipo                      public.tipo_movimiento,
  p_cantidad                  NUMERIC(12, 3),
  p_motivo                    TEXT DEFAULT NULL,
  p_referencia_tipo           public.referencia_tipo DEFAULT NULL,
  p_referencia_id             UUID DEFAULT NULL,
  p_usuario_id                UUID DEFAULT NULL,
  p_permitir_stock_negativo   BOOLEAN DEFAULT FALSE,
  p_proveedor_id              UUID DEFAULT NULL
) RETURNS public.movimiento AS $$
DECLARE
  v_usa_variantes   BOOLEAN;
  v_var_etiqueta    TEXT;
  v_stock_anterior  NUMERIC(12, 3);
  v_stock_posterior NUMERIC(12, 3);
  v_movimiento      public.movimiento;
BEGIN
  IF p_producto_variante_id IS NULL THEN
    RAISE EXCEPTION 'La variante es obligatoria';
  END IF;

  IF p_cantidad IS NULL THEN
    RAISE EXCEPTION 'La cantidad no puede ser nula';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.sucursal s
    WHERE s.id = p_sucursal_id
      AND s.tenant_id = p_tenant_id
      AND s.activa = true
  ) THEN
    RAISE EXCEPTION 'Sucursal invalida o inactiva para este negocio';
  END IF;

  SELECT p.usa_variantes INTO v_usa_variantes
  FROM public.producto p
  WHERE p.id = p_producto_id
    AND p.tenant_id = p_tenant_id
    AND p.activo = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado: %', p_producto_id;
  END IF;

  IF NOT v_usa_variantes THEN
    RAISE EXCEPTION 'Este producto no usa variantes';
  END IF;

  SELECT public.producto_variante_etiqueta(v.atributos, v.etiqueta)
    INTO v_var_etiqueta
  FROM public.producto_variante v
  WHERE v.id = p_producto_variante_id
    AND v.producto_id = p_producto_id
    AND v.tenant_id = p_tenant_id
    AND v.activo = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Variante no encontrada o inactiva: %', p_producto_variante_id;
  END IF;

  SELECT ss.stock_actual INTO v_stock_anterior
  FROM public.producto_variante_stock_sucursal ss
  WHERE ss.tenant_id = p_tenant_id
    AND ss.producto_id = p_producto_id
    AND ss.variante_id = p_producto_variante_id
    AND ss.sucursal_id = p_sucursal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.producto_variante_stock_sucursal (
      tenant_id, producto_id, variante_id, sucursal_id, stock_actual, stock_minimo, ubicacion
    )
    VALUES (p_tenant_id, p_producto_id, p_producto_variante_id, p_sucursal_id, 0, 0, NULL)
    ON CONFLICT (variante_id, sucursal_id) DO NOTHING;

    SELECT ss.stock_actual INTO v_stock_anterior
    FROM public.producto_variante_stock_sucursal ss
    WHERE ss.tenant_id = p_tenant_id
      AND ss.producto_id = p_producto_id
      AND ss.variante_id = p_producto_variante_id
      AND ss.sucursal_id = p_sucursal_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'No se pudo inicializar stock de la variante % en la sucursal %', p_producto_variante_id, p_sucursal_id;
    END IF;
  END IF;

  CASE p_tipo
    WHEN 'entrada' THEN
      IF p_cantidad <= 0 THEN
        RAISE EXCEPTION 'La cantidad de entrada debe ser mayor a cero';
      END IF;
      v_stock_posterior := v_stock_anterior + p_cantidad;
    WHEN 'salida' THEN
      IF p_cantidad <= 0 THEN
        RAISE EXCEPTION 'La cantidad de salida debe ser mayor a cero';
      END IF;
      v_stock_posterior := v_stock_anterior - p_cantidad;
      IF NOT p_permitir_stock_negativo AND v_stock_posterior < 0 THEN
        RAISE EXCEPTION 'Stock insuficiente. Actual: %, solicitado: %',
          v_stock_anterior, p_cantidad;
      END IF;
    WHEN 'ajuste' THEN
      v_stock_posterior := p_cantidad;
    ELSE
      RAISE EXCEPTION 'Tipo de movimiento no soportado: %', p_tipo;
  END CASE;

  UPDATE public.producto_variante_stock_sucursal ss
  SET stock_actual = v_stock_posterior, updated_at = NOW()
  WHERE ss.tenant_id = p_tenant_id
    AND ss.producto_id = p_producto_id
    AND ss.variante_id = p_producto_variante_id
    AND ss.sucursal_id = p_sucursal_id;

  INSERT INTO public.movimiento (
    tenant_id, sucursal_id, producto_id, producto_variante_id, producto_variante_etiqueta,
    tipo, cantidad, stock_anterior, stock_posterior, motivo, referencia_tipo, referencia_id,
    usuario_id, proveedor_id
  ) VALUES (
    p_tenant_id, p_sucursal_id, p_producto_id, p_producto_variante_id, v_var_etiqueta,
    p_tipo, p_cantidad, v_stock_anterior, v_stock_posterior, p_motivo, p_referencia_tipo,
    p_referencia_id, p_usuario_id, p_proveedor_id
  ) RETURNING * INTO v_movimiento;

  RETURN v_movimiento;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.transferir_stock_variante_entre_depositos(
  p_tenant_id                 UUID,
  p_producto_id               UUID,
  p_producto_variante_id      UUID,
  p_sucursal_origen_id        UUID,
  p_sucursal_destino_id       UUID,
  p_cantidad                  NUMERIC(12, 3),
  p_motivo                    TEXT DEFAULT NULL,
  p_usuario_id                UUID DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_xfer UUID;
  m_sal public.movimiento;
  m_ent public.movimiento;
  n_o TEXT;
  n_d TEXT;
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

  PERFORM pg_advisory_xact_lock(
    hashtext(
      p_tenant_id::text
      || p_producto_id::text
      || p_producto_variante_id::text
      || LEAST(p_sucursal_origen_id, p_sucursal_destino_id)::text
      || GREATEST(p_sucursal_origen_id, p_sucursal_destino_id)::text
    )
  );

  SELECT s.nombre INTO n_o FROM public.sucursal s WHERE s.id = p_sucursal_origen_id;
  SELECT s.nombre INTO n_d FROM public.sucursal s WHERE s.id = p_sucursal_destino_id;

  SELECT EXISTS (
    SELECT 1
    FROM public.producto_variante_stock_sucursal ss
    WHERE ss.tenant_id = p_tenant_id
      AND ss.variante_id = p_producto_variante_id
      AND ss.sucursal_id = p_sucursal_destino_id
  ) INTO v_dest_exists_before;

  v_xfer := gen_random_uuid();

  SELECT * INTO m_sal FROM public.registrar_movimiento_variante(
    p_tenant_id, p_producto_id, p_producto_variante_id, p_sucursal_origen_id,
    'salida'::public.tipo_movimiento, p_cantidad,
    'Transferencia a ' || COALESCE(n_d, '(sucursal)') || COALESCE(' - ' || NULLIF(btrim(COALESCE(p_motivo, '')), ''), ''),
    'transferencia_sucursal'::public.referencia_tipo, v_xfer, p_usuario_id, false
  );

  SELECT * INTO m_ent FROM public.registrar_movimiento_variante(
    p_tenant_id, p_producto_id, p_producto_variante_id, p_sucursal_destino_id,
    'entrada'::public.tipo_movimiento, p_cantidad,
    'Transferencia desde ' || COALESCE(n_o, '(sucursal)') || COALESCE(' - ' || NULLIF(btrim(COALESCE(p_motivo, '')), ''), ''),
    'transferencia_sucursal'::public.referencia_tipo, v_xfer, p_usuario_id, false
  );

  RETURN jsonb_build_object(
    'transfer_id', v_xfer,
    'movimiento_salida', to_jsonb(m_sal),
    'movimiento_entrada', to_jsonb(m_ent),
    'deposito_destino_creado', NOT v_dest_exists_before
  );
END;
$$;

GRANT ALL ON TABLE public.producto_variante TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.producto_variante_stock_sucursal TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.producto_variante_etiqueta(jsonb, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.registrar_movimiento(
  uuid, uuid, uuid, public.tipo_movimiento, numeric, text, public.referencia_tipo, uuid, uuid, boolean, uuid
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.registrar_movimiento_variante(
  uuid, uuid, uuid, uuid, public.tipo_movimiento, numeric, text, public.referencia_tipo, uuid, uuid, boolean, uuid
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.transferir_stock_variante_entre_depositos(
  uuid, uuid, uuid, uuid, uuid, numeric, text, uuid
) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
