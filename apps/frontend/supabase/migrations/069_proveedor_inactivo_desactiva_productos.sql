-- Al marcar un proveedor como inactivo, desactivar productos cuyo proveedor principal (producto.proveedor_id) es ese proveedor.
-- No altera productos que solo lo tengan como proveedor alternativo en producto_proveedor.

CREATE OR REPLACE FUNCTION public.proveedor_inactivo_desactiva_productos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.producto p
  SET activo = false,
      updated_at = now()
  WHERE p.proveedor_id = NEW.id
    AND p.tenant_id = NEW.tenant_id
    AND p.activo = true;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.proveedor_inactivo_desactiva_productos() IS
  'Trigger: al desactivar proveedor, pone activo=false en productos con ese proveedor_id.';

REVOKE ALL ON FUNCTION public.proveedor_inactivo_desactiva_productos() FROM PUBLIC;

DROP TRIGGER IF EXISTS proveedor_inactivo_desactiva_productos ON public.proveedor;

CREATE TRIGGER proveedor_inactivo_desactiva_productos
  AFTER UPDATE OF activo ON public.proveedor
  FOR EACH ROW
  WHEN (NEW.activo = false AND OLD.activo IS DISTINCT FROM false)
  EXECUTE FUNCTION public.proveedor_inactivo_desactiva_productos();
