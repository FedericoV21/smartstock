-- Vxx-PLAN-INTER-001: Plan intermedio + IA ilimitada a elección
--
-- Nuevo plan: 'intermedio'
-- Permite usar ambas IAs (lector de facturas + IA precios) pero deja una como ilimitada,
-- configurable en `tenant.ia_ilimitada_origen` (valores: 'lector_factura' | 'ia_pdf').
--
-- Nota: se usa TEXT + CHECK para evitar crear un enum nuevo.

-- ─── Enum plan_tipo ───────────────────────────────────────────────────

ALTER TYPE public.plan_tipo
  ADD VALUE IF NOT EXISTS 'intermedio';

-- ─── Tenant: preferencia IA ilimitada ─────────────────────────────────

ALTER TABLE public.tenant
  ADD COLUMN IF NOT EXISTS ia_ilimitada_origen TEXT;

ALTER TABLE public.tenant
  DROP CONSTRAINT IF EXISTS chk_tenant_ia_ilimitada_origen;

ALTER TABLE public.tenant
  ADD CONSTRAINT chk_tenant_ia_ilimitada_origen
  CHECK (
    ia_ilimitada_origen IS NULL
    OR ia_ilimitada_origen IN ('lector_factura', 'ia_pdf')
  );

COMMENT ON COLUMN public.tenant.ia_ilimitada_origen IS
  'En plan intermedio: define qué IA es ilimitada (lector_factura o ia_pdf).';

-- ─── activar_plan: agrega caso intermedio ─────────────────────────────

CREATE OR REPLACE FUNCTION public.activar_plan(
  p_tenant_id UUID,
  p_plan      public.plan_tipo
) RETURNS void AS $$
BEGIN
  UPDATE public.tenant
  SET
    plan = p_plan,
    ia_ilimitada_origen = CASE
      WHEN p_plan = 'intermedio' THEN COALESCE(ia_ilimitada_origen, 'ia_pdf')
      ELSE NULL
    END
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
      lector_facturas = true
    WHERE tenant_id = p_tenant_id;
  ELSIF p_plan = 'intermedio' THEN
    UPDATE public.modulo_config SET
      facturador_simple = true,
      facturador_arca = true,
      facturador_pos = true,
      pedidos = true,
      presupuestos = true,
      ia_precios = true,
      analizador_rentabilidad = true,
      lector_facturas = true
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
      lector_facturas = false
    WHERE tenant_id = p_tenant_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

