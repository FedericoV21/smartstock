-- V82-ORD-ALIGN-002: pedido.numero_orden para compartir orden con presupuesto/factura.
-- Alinea la cadena presupuesto → pedido → ticket/factura bajo un mismo numero_orden por tenant.

ALTER TABLE public.pedido
  ADD COLUMN IF NOT EXISTS numero_orden INTEGER;

COMMENT ON COLUMN public.pedido.numero_orden IS
  'Orden de venta interna por tenant (misma que comprobante.numero_orden). '
  'Propaga desde el presupuesto si existe; se asigna al facturar.';

CREATE INDEX IF NOT EXISTS idx_pedido_tenant_numero_orden
  ON public.pedido (tenant_id, numero_orden);

-- siguiente_numero_orden ahora considera comprobante + pedido para evitar colisiones.
CREATE OR REPLACE FUNCTION public.siguiente_numero_orden(p_tenant_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_comp INTEGER;
  v_max_ped  INTEGER;
BEGIN
  SELECT COALESCE(MAX(numero_orden), 0) INTO v_max_comp
  FROM public.comprobante
  WHERE tenant_id = p_tenant_id;

  SELECT COALESCE(MAX(numero_orden), 0) INTO v_max_ped
  FROM public.pedido
  WHERE tenant_id = p_tenant_id;

  RETURN GREATEST(v_max_comp, v_max_ped) + 1;
END;
$$;

COMMENT ON FUNCTION public.siguiente_numero_orden(UUID) IS
  'Siguiente número de orden (scope tenant) considerando comprobante + pedido. '
  'Presupuestos, tickets, facturas y pedidos del mismo hecho comparten este valor.';

GRANT EXECUTE ON FUNCTION public.siguiente_numero_orden(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.siguiente_numero_orden(UUID) TO service_role;
