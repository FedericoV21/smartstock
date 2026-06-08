-- Plan intermedio: habilitar módulo presupuestos (antes solo en plan completo).

UPDATE public.modulo_config mc
SET presupuestos = true, updated_at = now()
FROM public.tenant t
WHERE t.id = mc.tenant_id
  AND t.plan = 'intermedio'
  AND mc.presupuestos = false;

CREATE OR REPLACE FUNCTION public.activar_plan(
  p_tenant_id UUID,
  p_plan public.plan_tipo
) RETURNS void AS $$
BEGIN
  UPDATE public.tenant
  SET
    plan_cambiado_en = CASE
      WHEN plan IS DISTINCT FROM p_plan AND p_plan IN ('intermedio', 'completo') THEN now()
      WHEN plan IS DISTINCT FROM p_plan AND p_plan IN ('base', 'plan0') THEN NULL
      ELSE plan_cambiado_en
    END,
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
      presupuestos = true,
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
  ELSIF p_plan = 'plan0' THEN
    UPDATE public.modulo_config SET
      stock = true,
      importador_excel = true,
      facturador_simple = false,
      facturador_arca = false,
      facturador_pos = false,
      pedidos = false,
      presupuestos = false,
      ia_precios = false,
      analizador_rentabilidad = false,
      lector_facturas = false,
      despiece_carniceria = false,
      turnos = false,
      updated_at = now()
    WHERE tenant_id = p_tenant_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

NOTIFY pgrst, 'reload schema';
