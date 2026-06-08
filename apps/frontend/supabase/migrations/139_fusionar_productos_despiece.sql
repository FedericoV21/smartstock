-- Integración con fusión de productos.
-- Si el producto es padre de una plantilla, se bloquea su eliminación.
-- Si el producto aparece como hijo de despiece, también se bloquea para evitar
-- pérdida silenciosa de cortes en plantillas.

CREATE OR REPLACE FUNCTION public.producto_despiece_before_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(OLD.es_despiece_padre, false) THEN
    RAISE EXCEPTION 'No se puede fusionar o eliminar un producto que es padre de despiece. Eliminá la plantilla primero.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.despiece_corte dc
    WHERE dc.tenant_id = OLD.tenant_id
      AND dc.producto_hijo_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'No se puede fusionar o eliminar un producto que pertenece a una plantilla de despiece. Quitalo de la plantilla primero.';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS producto_despiece_before_delete ON public.producto;
CREATE TRIGGER producto_despiece_before_delete
  BEFORE DELETE ON public.producto
  FOR EACH ROW EXECUTE FUNCTION public.producto_despiece_before_delete();

COMMENT ON FUNCTION public.producto_despiece_before_delete() IS
  'Protege productos asociados a despiece antes de eliminarlos o fusionarlos.';

NOTIFY pgrst, 'reload schema';
