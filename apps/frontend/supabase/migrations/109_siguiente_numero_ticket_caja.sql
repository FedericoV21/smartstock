-- Plan cajas usuario — Fase 2 (RPC). La app puede seguir usando siguiente_numero_comprobante hasta conmutar el POS.

CREATE OR REPLACE FUNCTION public.siguiente_numero_ticket_caja (p_tenant_id uuid, p_caja_id uuid) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_siguiente integer;
BEGIN
  IF NOT EXISTS (
    SELECT
      1
    FROM
      public.caja c
    WHERE
      c.id = p_caja_id
      AND c.tenant_id = p_tenant_id
      AND c.activa = true
  ) THEN
    RAISE EXCEPTION 'Caja % no existe, no pertenece al tenant % o está inactiva', p_caja_id, p_tenant_id;
  END IF;

  SELECT
    COALESCE(MAX(c.numero_caja), 0) + 1 INTO v_siguiente
  FROM
    public.comprobante c
  WHERE
    c.tenant_id = p_tenant_id
    AND c.tipo = 'ticket'::public.tipo_comprobante
    AND c.caja_uuid = p_caja_id;

  RETURN v_siguiente;
END;
$$;

REVOKE ALL ON FUNCTION public.siguiente_numero_ticket_caja (uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.siguiente_numero_ticket_caja (uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.siguiente_numero_ticket_caja (uuid, uuid) IS
  'Siguiente número de ticket para la caja (correlativo por caja_uuid). Idempotencia vía uk_comprobante_ticket_caja_numero al insertar.';

CREATE INDEX IF NOT EXISTS idx_comprobante_ticket_caja_numero_caja_lookup ON public.comprobante (tenant_id, caja_uuid)
WHERE
  tipo = 'ticket'::public.tipo_comprobante
  AND caja_uuid IS NOT NULL;
