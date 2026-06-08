-- Plan base: pedidos e IA de precios disponibles en todos los planes.
-- Plan completo sigue sumando ARCA y presupuestos (y refuerza el resto).
CREATE OR REPLACE FUNCTION activar_plan(
  p_tenant_id UUID,
  p_plan      plan_tipo
) RETURNS void AS $$
BEGIN
  UPDATE tenant SET plan = p_plan WHERE id = p_tenant_id;

  IF p_plan = 'completo' THEN
    UPDATE modulo_config SET
      facturador_simple = true,
      facturador_arca = true,
      pedidos = true,
      presupuestos = true,
      ia_precios = true
    WHERE tenant_id = p_tenant_id;
  ELSIF p_plan = 'base' THEN
    UPDATE modulo_config SET
      facturador_arca = false,
      presupuestos = false,
      pedidos = true,
      ia_precios = true
    WHERE tenant_id = p_tenant_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
