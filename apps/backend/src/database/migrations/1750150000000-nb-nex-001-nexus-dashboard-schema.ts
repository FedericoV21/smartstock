import type { MigrationInterface, QueryRunner } from 'typeorm';

export class NbNex001NexusDashboardSchema1750150000000 implements MigrationInterface {
  name = 'NbNex001NexusDashboardSchema1750150000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE public.tenant
  ADD COLUMN IF NOT EXISTS plan_cambiado_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mensualidad_corte_dia SMALLINT,
  ADD COLUMN IF NOT EXISTS ginkgo_monto_abonado NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS ginkgo_porcentaje NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS ginkgo_facturacion_actualizada_en TIMESTAMPTZ;

ALTER TABLE public.usuario
  ADD COLUMN IF NOT EXISTS es_prueba BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_mensualidad_corte_dia_check'
  ) THEN
    ALTER TABLE public.tenant
      ADD CONSTRAINT tenant_mensualidad_corte_dia_check
      CHECK (mensualidad_corte_dia IS NULL OR (mensualidad_corte_dia >= 1 AND mensualidad_corte_dia <= 28));
  END IF;
END $$;

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
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE public.usuario DROP COLUMN IF EXISTS es_prueba;
ALTER TABLE public.tenant
  DROP COLUMN IF EXISTS ginkgo_facturacion_actualizada_en,
  DROP COLUMN IF EXISTS ginkgo_porcentaje,
  DROP COLUMN IF EXISTS ginkgo_monto_abonado,
  DROP COLUMN IF EXISTS mensualidad_corte_dia,
  DROP COLUMN IF EXISTS plan_cambiado_en;
`);
  }
}
