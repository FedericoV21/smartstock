-- Sucursales creadas después de 108 (o sin backfill) pueden no tener fila en public.caja.
-- Idempotente: solo inserta donde no exista ninguna caja para esa sucursal.

INSERT INTO public.caja (tenant_id, sucursal_id, numero, nombre)
SELECT
  s.tenant_id,
  s.id,
  1,
  'Caja general'
FROM
  public.sucursal s
WHERE
  s.activa = true
  AND NOT EXISTS (
    SELECT
      1
    FROM
      public.caja c
    WHERE
      c.sucursal_id = s.id
      AND c.tenant_id = s.tenant_id
  );
