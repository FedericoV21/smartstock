-- Orden de venta interna (única por tenant): enlaza ticket + factura fiscal del mismo cobro.

CREATE OR REPLACE FUNCTION public.siguiente_numero_orden(p_tenant_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sig INTEGER;
BEGIN
  SELECT COALESCE(MAX(numero_orden), 0) + 1 INTO v_sig
  FROM public.comprobante
  WHERE tenant_id = p_tenant_id;
  RETURN v_sig;
END;
$$;

COMMENT ON FUNCTION public.siguiente_numero_orden(UUID) IS
  'Siguiente número de orden de venta (scope tenant). La factura fiscal por ticket reutiliza el numero_orden del ticket.';

GRANT EXECUTE ON FUNCTION public.siguiente_numero_orden(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.siguiente_numero_orden(UUID) TO service_role;

ALTER TABLE public.comprobante
  ADD COLUMN IF NOT EXISTS numero_orden INTEGER;

COMMENT ON COLUMN public.comprobante.numero_orden IS
  'Orden de venta interna por tenant. Mismo valor en ticket y en la factura fiscal emitida desde ese ticket.';

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY created_at) AS n
  FROM public.comprobante
  WHERE numero_orden IS NULL
)
UPDATE public.comprobante c
SET numero_orden = r.n
FROM ranked r
WHERE c.id = r.id;

-- Misma orden de venta en la factura fiscal que en el ticket que la originó.
UPDATE public.comprobante f
SET numero_orden = t.numero_orden
FROM public.comprobante t
WHERE t.fiscalizado_por_id = f.id
  AND t.tipo = 'ticket';

ALTER TABLE public.comprobante
  ALTER COLUMN numero_orden SET NOT NULL;

ALTER TABLE public.comprobante
  ADD CONSTRAINT chk_comprobante_numero_orden_positivo CHECK (numero_orden > 0);

CREATE INDEX IF NOT EXISTS idx_comprobante_tenant_numero_orden
  ON public.comprobante (tenant_id, numero_orden);
