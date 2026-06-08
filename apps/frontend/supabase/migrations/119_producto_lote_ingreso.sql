-- Lotes de ingreso por proveedor: cada importación / lectura de factura / alta puede generar un lote
-- con su propio vencimiento, costo y proveedor. Permite convivencia de varios vencimientos en un único producto
-- (clave para la pref `unificar_productos_entre_proveedores`).

CREATE TABLE public.producto_lote_ingreso (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  producto_id UUID NOT NULL REFERENCES public.producto (id) ON DELETE CASCADE,
  sucursal_id UUID NOT NULL REFERENCES public.sucursal (id) ON DELETE RESTRICT,
  proveedor_id UUID NULL REFERENCES public.proveedor (id) ON DELETE SET NULL,
  cantidad NUMERIC(12, 3) NOT NULL,
  fecha_vencimiento DATE NULL,
  precio_costo NUMERIC(18, 6) NULL,
  origen TEXT NOT NULL,
  importacion_log_id UUID NULL REFERENCES public.importacion_log (id) ON DELETE SET NULL,
  lector_factura_log_id UUID NULL REFERENCES public.lector_factura_log (id) ON DELETE SET NULL,
  movimiento_id UUID NULL REFERENCES public.movimiento (id) ON DELETE SET NULL,
  creado_por UUID NULL REFERENCES public.usuario (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_producto_lote_origen CHECK (
    origen IN ('importacion', 'lector_facturas', 'manual', 'pos', 'comprobante_compra')
  )
);

CREATE INDEX idx_producto_lote_tenant_producto
  ON public.producto_lote_ingreso (tenant_id, producto_id);

CREATE INDEX idx_producto_lote_tenant_producto_vencimiento
  ON public.producto_lote_ingreso (tenant_id, producto_id, fecha_vencimiento)
  WHERE fecha_vencimiento IS NOT NULL;

CREATE INDEX idx_producto_lote_tenant_proveedor
  ON public.producto_lote_ingreso (tenant_id, proveedor_id)
  WHERE proveedor_id IS NOT NULL;

CREATE INDEX idx_producto_lote_movimiento
  ON public.producto_lote_ingreso (movimiento_id)
  WHERE movimiento_id IS NOT NULL;

COMMENT ON TABLE public.producto_lote_ingreso IS
  'Lotes de ingreso por proveedor: cada entrada queda registrada con cantidad, vencimiento y costo. La pref "unificar_productos_entre_proveedores" usa esta tabla para conservar todos los vencimientos cuando se fusiona el catálogo.';

CREATE TRIGGER set_producto_lote_ingreso_updated_at
  BEFORE UPDATE ON public.producto_lote_ingreso
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime (updated_at);

ALTER TABLE public.producto_lote_ingreso ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_select_producto_lote_ingreso
  ON public.producto_lote_ingreso FOR SELECT
  USING (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_insert_producto_lote_ingreso
  ON public.producto_lote_ingreso FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_update_producto_lote_ingreso
  ON public.producto_lote_ingreso FOR UPDATE
  USING (tenant_id = public.current_tenant_id ())
  WITH CHECK (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_delete_producto_lote_ingreso
  ON public.producto_lote_ingreso FOR DELETE
  USING (tenant_id = public.current_tenant_id ());

-- Devuelve la fecha de vencimiento más próxima entre los lotes vivos (cantidad > 0).
CREATE OR REPLACE FUNCTION public.fecha_vencimiento_proxima_lote(
  p_producto_id UUID
) RETURNS DATE
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT MIN(fecha_vencimiento)
  FROM public.producto_lote_ingreso
  WHERE producto_id = p_producto_id
    AND cantidad > 0
    AND fecha_vencimiento IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION public.fecha_vencimiento_proxima_lote(uuid) TO authenticated, service_role;

-- Trigger: cada vez que cambia un lote, refresca producto.fecha_vencimiento con el próximo a vencer.
-- Si no hay lotes vivos con vencimiento, no toca la columna (puede haberla seteado el alta directa).
CREATE OR REPLACE FUNCTION public.trg_producto_lote_refresh_vencimiento()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_producto_id UUID;
  v_proxima DATE;
  v_existe BOOLEAN;
BEGIN
  v_producto_id := COALESCE(NEW.producto_id, OLD.producto_id);
  IF v_producto_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.producto_lote_ingreso
    WHERE producto_id = v_producto_id
      AND cantidad > 0
      AND fecha_vencimiento IS NOT NULL
  ) INTO v_existe;

  IF v_existe THEN
    SELECT MIN(fecha_vencimiento) INTO v_proxima
    FROM public.producto_lote_ingreso
    WHERE producto_id = v_producto_id
      AND cantidad > 0
      AND fecha_vencimiento IS NOT NULL;

    UPDATE public.producto
    SET fecha_vencimiento = v_proxima
    WHERE id = v_producto_id
      AND fecha_vencimiento IS DISTINCT FROM v_proxima;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.trg_producto_lote_refresh_vencimiento() FROM PUBLIC;

CREATE TRIGGER trg_producto_lote_refresh_vencimiento_aiu
  AFTER INSERT OR UPDATE OR DELETE ON public.producto_lote_ingreso
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_producto_lote_refresh_vencimiento();

NOTIFY pgrst, 'reload schema';
