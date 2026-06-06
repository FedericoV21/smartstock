import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-ARC-108: RPCs numeraci├│n ARCA (paridad frontend 086 + 094).
 * Grants: current_user (Postgres Nest) + roles Supabase si existen.
 */
export class NbArc108ArcaNumeracionRpcs1749600000000 implements MigrationInterface {
  name = 'NbArc108ArcaNumeracionRpcs1749600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE OR REPLACE FUNCTION public.lock_arca_config_for_update(
  p_tenant_id uuid,
  p_sucursal_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  PERFORM 1
  FROM public.arca_config
  WHERE tenant_id = p_tenant_id
    AND sucursal_id = p_sucursal_id
  FOR UPDATE;
END;
$$;

COMMENT ON FUNCTION public.lock_arca_config_for_update(uuid, uuid) IS
  'Serializa emisiones ARCA por tenant+sucursal (SELECT FOR UPDATE sobre arca_config).';

DROP FUNCTION IF EXISTS public.siguiente_numero_comprobante(uuid, public.tipo_comprobante);

CREATE OR REPLACE FUNCTION public.siguiente_numero_comprobante(
  p_tenant_id uuid,
  p_sucursal_id uuid,
  p_tipo public.tipo_comprobante
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_siguiente integer;
BEGIN
  SELECT COALESCE(MAX(c.numero), 0) + 1
  INTO v_siguiente
  FROM public.comprobante c
  WHERE c.tenant_id = p_tenant_id
    AND c.sucursal_id = p_sucursal_id
    AND c.tipo = p_tipo
    AND c.numero IS NOT NULL
    AND c.numero > 0;

  RETURN v_siguiente;
END;
$$;

COMMENT ON FUNCTION public.siguiente_numero_comprobante(uuid, uuid, public.tipo_comprobante) IS
  'Siguiente n├║mero local por tenant+sucursal+tipo (excluye NULL y archivados negativos).';
`);

    await queryRunner.query(`
DO $grant$
BEGIN
  REVOKE ALL ON FUNCTION public.lock_arca_config_for_update(uuid, uuid) FROM PUBLIC;
  EXECUTE format(
    'GRANT EXECUTE ON FUNCTION public.lock_arca_config_for_update(uuid, uuid) TO %I',
    current_user
  );
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION public.lock_arca_config_for_update(uuid, uuid) TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.lock_arca_config_for_update(uuid, uuid) TO service_role;
  END IF;

  REVOKE ALL ON FUNCTION public.siguiente_numero_comprobante(uuid, uuid, public.tipo_comprobante) FROM PUBLIC;
  EXECUTE format(
    'GRANT EXECUTE ON FUNCTION public.siguiente_numero_comprobante(uuid, uuid, public.tipo_comprobante) TO %I',
    current_user
  );
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION public.siguiente_numero_comprobante(uuid, uuid, public.tipo_comprobante) TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.siguiente_numero_comprobante(uuid, uuid, public.tipo_comprobante) TO service_role;
  END IF;
END $grant$;
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP FUNCTION IF EXISTS public.siguiente_numero_comprobante(uuid, uuid, public.tipo_comprobante);
DROP FUNCTION IF EXISTS public.lock_arca_config_for_update(uuid, uuid);
`);
  }
}
