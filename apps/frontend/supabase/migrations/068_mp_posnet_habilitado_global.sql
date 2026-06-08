-- MP Point / POSNet: módulo y flag habilitado para todos los tenants existentes.
-- Nuevos inserts en mp_point_config quedan con habilitado = true por defecto.

-- POS solo es válido si hay facturación simple (chk_pos_requiere_facturador).
UPDATE public.modulo_config
SET facturador_pos = true
WHERE facturador_simple = true
  AND facturador_pos IS NOT TRUE;

ALTER TABLE public.mp_point_config
  ALTER COLUMN habilitado SET DEFAULT true;

INSERT INTO public.mp_point_config (tenant_id, habilitado)
SELECT t.id, true
FROM public.tenant t
ON CONFLICT (tenant_id) DO UPDATE
SET
  habilitado = true,
  updated_at = now();
