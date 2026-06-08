-- V60-POS-003: Add facturador_pos flag to modulo_config and update activar_plan

-- New column
ALTER TABLE modulo_config
  ADD COLUMN IF NOT EXISTS facturador_pos BOOLEAN NOT NULL DEFAULT false;

-- POS requires the base invoicing module
ALTER TABLE modulo_config
  ADD CONSTRAINT chk_pos_requiere_facturador
  CHECK (facturador_pos = false OR facturador_simple = true);

-- Update activar_plan to include facturador_pos
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
      facturador_pos = true,
      pedidos = true,
      presupuestos = true,
      ia_precios = true,
      analizador_rentabilidad = true
    WHERE tenant_id = p_tenant_id;
  ELSIF p_plan = 'base' THEN
    UPDATE modulo_config SET
      facturador_arca = false,
      facturador_pos = false,
      pedidos = false,
      presupuestos = false,
      ia_precios = false,
      analizador_rentabilidad = false
    WHERE tenant_id = p_tenant_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
