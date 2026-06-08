-- Plan J v9.0: numeración fiscal asignada por ARCA al obtener CAE; tracking de intentos.
-- Auditoría previa (ejecutar en SQL Editor antes de aplicar, debe devolver 0 filas tras limpieza manual):
--   SELECT tenant_id, id, tipo, numero, estado, cae, created_at
--   FROM comprobante
--   WHERE estado IN ('pendiente_arca', 'error_arca') AND numero IS NOT NULL;

ALTER TABLE public.comprobante ALTER COLUMN numero DROP NOT NULL;

-- Desincronización: si hay CAE AFIP válido, el comprobante debe ser emitido.
UPDATE public.comprobante c
SET estado = 'emitido'
WHERE c.estado IN ('pendiente_arca', 'error_arca')
  AND c.cae IS NOT NULL
  AND trim(c.cae) ~ '^\d{14}$';

-- Nuevo modelo: pendiente_arca / error_arca sin CAE válido no conservan número fiscal.
UPDATE public.comprobante c
SET numero = NULL
WHERE c.estado IN ('pendiente_arca', 'error_arca')
  AND (c.cae IS NULL OR trim(c.cae) !~ '^\d{14}$');

ALTER TABLE public.comprobante
  ADD COLUMN IF NOT EXISTS intentos_arca INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.comprobante
  ADD COLUMN IF NOT EXISTS ultimo_error_arca_codigo VARCHAR(20);

ALTER TABLE public.comprobante
  ADD COLUMN IF NOT EXISTS ultimo_error_arca_mensaje TEXT;

ALTER TABLE public.comprobante
  ADD COLUMN IF NOT EXISTS ultimo_intento_arca_at TIMESTAMPTZ;

ALTER TABLE public.comprobante DROP CONSTRAINT IF EXISTS chk_emitido_fiscal_tiene_numero;
ALTER TABLE public.comprobante ADD CONSTRAINT chk_emitido_fiscal_tiene_numero
  CHECK (
    NOT (
      tipo IN (
        'factura_a', 'factura_b', 'factura_c',
        'nota_credito_a', 'nota_credito_b', 'nota_credito_c'
      )
      AND estado = 'emitido'
      AND numero IS NULL
    )
  );

ALTER TABLE public.comprobante DROP CONSTRAINT IF EXISTS chk_pendiente_arca_sin_numero;
ALTER TABLE public.comprobante ADD CONSTRAINT chk_pendiente_arca_sin_numero
  CHECK (
    estado NOT IN ('pendiente_arca', 'error_arca') OR numero IS NULL
  );

-- Bloqueo pesimista de fila arca_config por tenant (usado desde TS antes de FECAESolicitar).
CREATE OR REPLACE FUNCTION public.lock_arca_config_for_update(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM 1 FROM public.arca_config WHERE tenant_id = p_tenant_id FOR UPDATE;
END;
$$;

REVOKE ALL ON FUNCTION public.lock_arca_config_for_update(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lock_arca_config_for_update(uuid) TO authenticated, service_role;

-- Estimación local del siguiente número con CAE (FECompUltimoAutorizado se consulta en TS).
CREATE OR REPLACE FUNCTION public.siguiente_numero_arca(
  p_tenant_id uuid,
  p_tipo public.tipo_comprobante,
  p_punto_de_venta integer
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_local integer;
BEGIN
  -- p_punto_de_venta reservado para futuro PdV por sucursal; hoy la numeración local no filtra por PdV en filas.
  SELECT COALESCE(MAX(c.numero), 0) INTO v_max_local
  FROM public.comprobante c
  WHERE c.tenant_id = p_tenant_id
    AND c.tipo = p_tipo
    AND c.numero IS NOT NULL
    AND c.cae IS NOT NULL;

  RETURN v_max_local + 1;
END;
$$;

REVOKE ALL ON FUNCTION public.siguiente_numero_arca(uuid, public.tipo_comprobante, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.siguiente_numero_arca(uuid, public.tipo_comprobante, integer) TO authenticated, service_role;

COMMENT ON COLUMN public.comprobante.intentos_arca IS 'Intentos de solicitud CAE (WSFE); fuente principal para tope de reintentos.';
COMMENT ON COLUMN public.comprobante.ultimo_error_arca_codigo IS 'Código AFIP u observación del último rechazo o NETWORK.';
COMMENT ON FUNCTION public.lock_arca_config_for_update IS 'Serializa emisiones ARCA por tenant (SELECT FOR UPDATE sobre arca_config).';

-- ROLLBACK (manual)
-- ALTER TABLE comprobante DROP CONSTRAINT IF EXISTS chk_emitido_fiscal_tiene_numero;
-- ALTER TABLE comprobante DROP CONSTRAINT IF EXISTS chk_pendiente_arca_sin_numero;
-- ALTER TABLE comprobante DROP COLUMN IF EXISTS intentos_arca;
-- ALTER TABLE comprobante DROP COLUMN IF EXISTS ultimo_error_arca_codigo;
-- ALTER TABLE comprobante DROP COLUMN IF EXISTS ultimo_error_arca_mensaje;
-- ALTER TABLE comprobante DROP COLUMN IF EXISTS ultimo_intento_arca_at;
-- DROP FUNCTION IF EXISTS public.lock_arca_config_for_update(uuid);
-- DROP FUNCTION IF EXISTS public.siguiente_numero_arca(uuid, public.tipo_comprobante, integer);
-- ALTER TABLE comprobante ALTER COLUMN numero SET NOT NULL;
