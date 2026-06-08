ALTER TABLE public.modulo_config
  ADD COLUMN IF NOT EXISTS despiece_carniceria BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE public.modulo_config
SET despiece_carniceria = TRUE,
    updated_at = now()
WHERE despiece_carniceria IS DISTINCT FROM TRUE;

COMMENT ON COLUMN public.modulo_config.despiece_carniceria IS
  'Módulo de despiece de carnicerías: pricing por cortes.';

CREATE OR REPLACE FUNCTION public.activar_plan(
  p_tenant_id UUID,
  p_plan public.plan_tipo
) RETURNS void AS $$
BEGIN
  UPDATE public.tenant
  SET
    plan = p_plan,
    ia_ilimitada_origen = CASE
      WHEN p_plan = 'intermedio' THEN COALESCE(ia_ilimitada_origen, 'ia_pdf')
      ELSE NULL
    END,
    updated_at = now()
  WHERE id = p_tenant_id;

  IF p_plan = 'completo' THEN
    UPDATE public.modulo_config SET
      facturador_simple = true,
      facturador_arca = true,
      facturador_pos = true,
      pedidos = true,
      presupuestos = true,
      ia_precios = true,
      analizador_rentabilidad = true,
      lector_facturas = true,
      despiece_carniceria = true,
      updated_at = now()
    WHERE tenant_id = p_tenant_id;
  ELSIF p_plan = 'intermedio' THEN
    UPDATE public.modulo_config SET
      facturador_simple = true,
      facturador_arca = true,
      facturador_pos = true,
      pedidos = true,
      presupuestos = false,
      ia_precios = true,
      analizador_rentabilidad = false,
      lector_facturas = true,
      despiece_carniceria = true,
      updated_at = now()
    WHERE tenant_id = p_tenant_id;
  ELSIF p_plan = 'base' THEN
    UPDATE public.modulo_config SET
      facturador_simple = true,
      facturador_arca = true,
      facturador_pos = true,
      pedidos = true,
      presupuestos = false,
      ia_precios = false,
      analizador_rentabilidad = false,
      lector_facturas = false,
      despiece_carniceria = true,
      updated_at = now()
    WHERE tenant_id = p_tenant_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

NOTIFY pgrst, 'reload schema';
