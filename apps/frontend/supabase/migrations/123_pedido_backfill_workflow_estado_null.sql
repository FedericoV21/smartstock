-- Re-backfill pedidos sin workflow_estado_id (p. ej. creados desde la API sin esa columna).

UPDATE public.pedido p
SET workflow_estado_id = w.id
FROM public.pedido_estado_workflow w
WHERE p.workflow_estado_id IS NULL
  AND w.tenant_id = p.tenant_id
  AND lower(w.slug) = lower(p.estado::text);
