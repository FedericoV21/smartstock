-- Fase 2 — producto único por tenant: tablas nuevas en convivencia con stock en `producto`.
-- Sincronización bidireccional `producto` ↔ `stock_sucursal` (guard anti-recursión).

CREATE TABLE public.stock_sucursal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  producto_id UUID NOT NULL REFERENCES public.producto (id) ON DELETE CASCADE,
  sucursal_id UUID NOT NULL REFERENCES public.sucursal (id) ON DELETE RESTRICT,
  stock_actual NUMERIC(12, 3) NOT NULL DEFAULT 0,
  stock_minimo NUMERIC(12, 3) NOT NULL DEFAULT 0,
  ubicacion TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uk_stock_sucursal_producto_sucursal UNIQUE (producto_id, sucursal_id)
);

CREATE INDEX idx_stock_sucursal_tenant ON public.stock_sucursal (tenant_id);
CREATE INDEX idx_stock_sucursal_sucursal ON public.stock_sucursal (sucursal_id);
CREATE INDEX idx_stock_sucursal_bajo
  ON public.stock_sucursal (tenant_id, sucursal_id)
  WHERE stock_actual <= stock_minimo;

COMMENT ON TABLE public.stock_sucursal IS
  'Stock por depósito/sucursal (fase producto único). Convive con producto.stock_actual vía triggers hasta migración completa.';

CREATE TRIGGER set_stock_sucursal_updated_at
  BEFORE UPDATE ON public.stock_sucursal
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime (updated_at);

ALTER TABLE public.stock_sucursal ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_select_stock_sucursal
  ON public.stock_sucursal FOR SELECT
  USING (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_insert_stock_sucursal
  ON public.stock_sucursal FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_update_stock_sucursal
  ON public.stock_sucursal FOR UPDATE
  USING (tenant_id = public.current_tenant_id ())
  WITH CHECK (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_delete_stock_sucursal
  ON public.stock_sucursal FOR DELETE
  USING (tenant_id = public.current_tenant_id ());

CREATE TABLE public.precio_sucursal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  producto_id UUID NOT NULL REFERENCES public.producto (id) ON DELETE CASCADE,
  sucursal_id UUID NOT NULL REFERENCES public.sucursal (id) ON DELETE RESTRICT,
  precio_costo NUMERIC(12, 2),
  precio_venta NUMERIC(12, 2),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_precio_sucursal_positivo CHECK (
    (precio_costo IS NULL OR precio_costo >= 0)
    AND (precio_venta IS NULL OR precio_venta >= 0)
  ),
  CONSTRAINT uk_precio_sucursal_producto_sucursal UNIQUE (producto_id, sucursal_id)
);

CREATE INDEX idx_precio_sucursal_tenant ON public.precio_sucursal (tenant_id);

COMMENT ON TABLE public.precio_sucursal IS
  'Override de precios por sucursal (opcional). Si no hay fila, rigen producto.precio_costo / precio_venta.';

CREATE TRIGGER set_precio_sucursal_updated_at
  BEFORE UPDATE ON public.precio_sucursal
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime (updated_at);

ALTER TABLE public.precio_sucursal ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_select_precio_sucursal
  ON public.precio_sucursal FOR SELECT
  USING (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_insert_precio_sucursal
  ON public.precio_sucursal FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_update_precio_sucursal
  ON public.precio_sucursal FOR UPDATE
  USING (tenant_id = public.current_tenant_id ())
  WITH CHECK (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_delete_precio_sucursal
  ON public.precio_sucursal FOR DELETE
  USING (tenant_id = public.current_tenant_id ());

INSERT INTO public.stock_sucursal (tenant_id, producto_id, sucursal_id, stock_actual, stock_minimo, ubicacion)
SELECT p.tenant_id, p.id, p.sucursal_id, p.stock_actual, p.stock_minimo, p.ubicacion
FROM public.producto p
WHERE p.activo = true
  AND p.sucursal_id IS NOT NULL
ON CONFLICT (producto_id, sucursal_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.trg_producto_after_insert_stock_sucursal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.sucursal_id IS NOT NULL THEN
    INSERT INTO public.stock_sucursal (tenant_id, producto_id, sucursal_id, stock_actual, stock_minimo, ubicacion)
    VALUES (NEW.tenant_id, NEW.id, NEW.sucursal_id, NEW.stock_actual, NEW.stock_minimo, NEW.ubicacion)
    ON CONFLICT (producto_id, sucursal_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_producto_after_insert_stock_sucursal() FROM PUBLIC;

CREATE TRIGGER trg_producto_after_insert_stock_sucursal
  AFTER INSERT ON public.producto
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_producto_after_insert_stock_sucursal();

CREATE OR REPLACE FUNCTION public.trg_stock_sucursal_after_update_sync_producto()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(current_setting('app.suppress_stock_sync', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  PERFORM set_config('app.suppress_stock_sync', 'on', true);
  UPDATE public.producto p
  SET
    stock_actual = NEW.stock_actual,
    stock_minimo = NEW.stock_minimo,
    ubicacion = NEW.ubicacion,
    updated_at = NOW()
  WHERE p.id = NEW.producto_id
    AND p.sucursal_id = NEW.sucursal_id
    AND p.tenant_id = NEW.tenant_id;
  PERFORM set_config('app.suppress_stock_sync', '', true);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_stock_sucursal_after_update_sync_producto() FROM PUBLIC;

CREATE TRIGGER trg_stock_sucursal_after_update_sync_producto
  AFTER UPDATE OF stock_actual, stock_minimo, ubicacion ON public.stock_sucursal
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_stock_sucursal_after_update_sync_producto();

CREATE OR REPLACE FUNCTION public.trg_producto_after_update_sync_stock_sucursal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.sucursal_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF COALESCE(current_setting('app.suppress_stock_sync', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  PERFORM set_config('app.suppress_stock_sync', 'on', true);
  UPDATE public.stock_sucursal ss
  SET
    stock_actual = NEW.stock_actual,
    stock_minimo = NEW.stock_minimo,
    ubicacion = NEW.ubicacion,
    updated_at = NOW()
  WHERE ss.producto_id = NEW.id
    AND ss.sucursal_id = NEW.sucursal_id
    AND ss.tenant_id = NEW.tenant_id;
  IF NOT FOUND THEN
    INSERT INTO public.stock_sucursal (tenant_id, producto_id, sucursal_id, stock_actual, stock_minimo, ubicacion)
    VALUES (NEW.tenant_id, NEW.id, NEW.sucursal_id, NEW.stock_actual, NEW.stock_minimo, NEW.ubicacion)
    ON CONFLICT (producto_id, sucursal_id) DO NOTHING;
  END IF;
  PERFORM set_config('app.suppress_stock_sync', '', true);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_producto_after_update_sync_stock_sucursal() FROM PUBLIC;

CREATE TRIGGER trg_producto_after_update_sync_stock_sucursal
  AFTER UPDATE OF stock_actual, stock_minimo, ubicacion ON public.producto
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_producto_after_update_sync_stock_sucursal();

NOTIFY pgrst, 'reload schema';
