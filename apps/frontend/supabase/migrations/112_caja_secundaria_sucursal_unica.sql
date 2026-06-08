-- Varias personas pueden operar a la vez en la misma sucursal si hay más de una caja
-- (cada caja admite un solo turno abierto: uk_caja_turno_caja_abierto).
-- Donde solo existía «Caja general» (una fila), agregamos una segunda caja.

INSERT INTO public.caja (tenant_id, sucursal_id, numero, nombre)
SELECT
  s.tenant_id,
  s.id,
  (SELECT COALESCE(MAX(c.numero), 0) + 1 FROM public.caja c WHERE c.sucursal_id = s.id AND c.tenant_id = s.tenant_id),
  'Caja secundaria'
FROM
  public.sucursal s
WHERE
  s.activa = true
  AND (
    SELECT
      COUNT(*)
    FROM
      public.caja c
    WHERE
      c.sucursal_id = s.id
      AND c.tenant_id = s.tenant_id
  ) = 1;
