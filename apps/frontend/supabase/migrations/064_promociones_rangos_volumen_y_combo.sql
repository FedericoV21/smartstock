-- Parte 2/2: columnas, CHECK que referencia combo_precio_fijo, promocion_combo_item (ver 055).

ALTER TABLE public.promocion
  ADD COLUMN IF NOT EXISTS rangos_volumen JSONB,
  ADD COLUMN IF NOT EXISTS precio_combo NUMERIC(14, 2);

ALTER TABLE public.promocion DROP CONSTRAINT IF EXISTS chk_promo_porcentaje_valido;
ALTER TABLE public.promocion DROP CONSTRAINT IF EXISTS chk_promo_volumen_minimo;

ALTER TABLE public.promocion
  ADD CONSTRAINT chk_promo_porcentaje_valido CHECK (
    (
      tipo NOT IN (
        'porcentaje_off'::public.promocion_tipo,
        'porcentaje_unidad_n'::public.promocion_tipo
      )
      OR (
        porcentaje IS NOT NULL
        AND porcentaje > 0
        AND porcentaje <= 100
      )
    )
    AND (
      tipo <> 'descuento_volumen'::public.promocion_tipo
      OR (
        (
          rangos_volumen IS NOT NULL
          AND jsonb_array_length(rangos_volumen) > 0
        )
        OR (
          cantidad_minima IS NOT NULL
          AND cantidad_minima >= 2
          AND porcentaje IS NOT NULL
          AND porcentaje > 0
          AND porcentaje <= 100
        )
      )
    )
    AND (
      tipo <> 'combo_precio_fijo'::public.promocion_tipo
      OR (
        precio_combo IS NOT NULL
        AND precio_combo > 0
      )
    )
  );

CREATE TABLE IF NOT EXISTS public.promocion_combo_item (
  promocion_id UUID NOT NULL REFERENCES public.promocion (id) ON DELETE CASCADE,
  producto_id  UUID NOT NULL REFERENCES public.producto (id) ON DELETE CASCADE,
  tenant_id    UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  cantidad     INTEGER NOT NULL CHECK (cantidad >= 1),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now (),
  PRIMARY KEY (promocion_id, producto_id)
);

CREATE INDEX IF NOT EXISTS idx_promocion_combo_item_tenant ON public.promocion_combo_item (tenant_id);

CREATE INDEX IF NOT EXISTS idx_promocion_combo_item_producto ON public.promocion_combo_item (producto_id);

ALTER TABLE public.promocion_combo_item ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select_promocion_combo_item ON public.promocion_combo_item;
CREATE POLICY tenant_select_promocion_combo_item
  ON public.promocion_combo_item FOR SELECT
  USING (tenant_id = public.current_tenant_id ());

DROP POLICY IF EXISTS tenant_insert_promocion_combo_item ON public.promocion_combo_item;
CREATE POLICY tenant_insert_promocion_combo_item
  ON public.promocion_combo_item FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id ());

DROP POLICY IF EXISTS tenant_update_promocion_combo_item ON public.promocion_combo_item;
CREATE POLICY tenant_update_promocion_combo_item
  ON public.promocion_combo_item FOR UPDATE
  USING (tenant_id = public.current_tenant_id ())
  WITH CHECK (tenant_id = public.current_tenant_id ());

DROP POLICY IF EXISTS tenant_delete_promocion_combo_item ON public.promocion_combo_item;
CREATE POLICY tenant_delete_promocion_combo_item
  ON public.promocion_combo_item FOR DELETE
  USING (tenant_id = public.current_tenant_id ());

COMMENT ON COLUMN public.promocion.rangos_volumen IS
  'Opcional para descuento_volumen: tramos [{cantidad_desde, cantidad_hasta|null, porcentaje}]. Si NULL, se usan cantidad_minima y porcentaje.';

COMMENT ON COLUMN public.promocion.precio_combo IS
  'Para combo_precio_fijo: precio total del paquete definido en promocion_combo_item.';

COMMENT ON TABLE public.promocion_combo_item IS
  'Cantidades por producto que forman un combo (precio_combo por cada paquete completo).';
