-- Stock comprometido: pedidos confirmados (no altera stock_actual).
-- La app también puede calcular lo mismo vía consultas; la vista documenta el modelo.

CREATE OR REPLACE VIEW public.v_stock_comprometido AS
SELECT
  pi.producto_id,
  p.tenant_id,
  SUM(pi.cantidad)::numeric AS comprometido
FROM public.pedido_item pi
JOIN public.pedido p ON p.id = pi.pedido_id
WHERE p.estado = 'confirmado'
GROUP BY pi.producto_id, p.tenant_id;
