import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-PROV-010: funci├│n `fusionar_proveedores` adaptada al esquema Nest (sin RLS JWT).
 * Solo repunta tablas presentes en el backend Nest actual.
 */
export class NbProv010FusionarProveedoresFn1748600000000 implements MigrationInterface {
  name = 'NbProv010FusionarProveedoresFn1748600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE OR REPLACE FUNCTION public.fusionar_proveedores(
  p_tenant_id UUID,
  p_survivor_id UUID,
  p_loser_ids UUID[],
  p_dry_run BOOLEAN DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_losers UUID[];
  v_loser UUID;
  v_loser_cc UUID;
  v_surv_cc UUID;
  v_saldo_l NUMERIC;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant_id requerido';
  END IF;

  IF p_survivor_id IS NULL THEN
    RAISE EXCEPTION 'Indic├í el proveedor destino';
  END IF;

  IF p_loser_ids IS NULL OR coalesce(array_length(p_loser_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Indic├í al menos un proveedor a fusionar';
  END IF;

  SELECT coalesce(array_agg(DISTINCT x), ARRAY[]::UUID[])
  INTO v_losers
  FROM unnest(p_loser_ids) AS u(x)
  WHERE x IS DISTINCT FROM p_survivor_id;

  IF v_losers IS NULL OR coalesce(array_length(v_losers, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Los proveedores a fusionar deben ser distintos del destino';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.proveedor p
    WHERE p.id = p_survivor_id AND p.tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Proveedor destino no encontrado en el tenant';
  END IF;

  IF (
    SELECT count(*)::int FROM public.proveedor p
    WHERE p.tenant_id = p_tenant_id AND p.id = ANY (v_losers)
  ) <> array_length(v_losers, 1) THEN
    RAISE EXCEPTION 'Alg├║n proveedor a fusionar no existe en el tenant';
  END IF;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'dry_run', true,
      'survivor_id', p_survivor_id,
      'loser_ids', to_jsonb(v_losers),
      'counts', jsonb_build_object(
        'producto', (SELECT count(*)::int FROM public.producto WHERE tenant_id = p_tenant_id AND proveedor_id = ANY (v_losers)),
        'comprobante', (SELECT count(*)::int FROM public.comprobante WHERE tenant_id = p_tenant_id AND proveedor_id = ANY (v_losers)),
        'importacion_log', (SELECT count(*)::int FROM public.importacion_log WHERE tenant_id = p_tenant_id AND proveedor_id = ANY (v_losers)),
        'importacion_borrador', (SELECT count(*)::int FROM public.importacion_borrador WHERE tenant_id = p_tenant_id AND proveedor_id = ANY (v_losers)),
        'movimiento', (SELECT count(*)::int FROM public.movimiento WHERE tenant_id = p_tenant_id AND proveedor_id = ANY (v_losers)),
        'producto_lote_ingreso', (SELECT count(*)::int FROM public.producto_lote_ingreso WHERE tenant_id = p_tenant_id AND proveedor_id = ANY (v_losers)),
        'pago_proveedor_factura', (SELECT count(*)::int FROM public.pago_proveedor_factura WHERE tenant_id = p_tenant_id AND proveedor_id = ANY (v_losers))
      ),
      'cuentas_corriente', COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'proveedor_id', cc.proveedor_id,
              'cuenta_id', cc.id,
              'saldo', cc.saldo
            )
          )
          FROM public.cuenta_corriente cc
          WHERE cc.tenant_id = p_tenant_id
            AND cc.proveedor_id = ANY (v_losers)
        ),
        '[]'::jsonb
      )
    );
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('fusionar_proveedores:' || p_tenant_id::text || ':' || p_survivor_id::text));

  FOREACH v_loser IN ARRAY v_losers
  LOOP
    v_loser_cc := NULL;
    v_surv_cc := NULL;
    v_saldo_l := NULL;

    SELECT id INTO v_surv_cc
    FROM public.cuenta_corriente
    WHERE tenant_id = p_tenant_id AND proveedor_id = p_survivor_id
    LIMIT 1;

    SELECT id, saldo INTO v_loser_cc, v_saldo_l
    FROM public.cuenta_corriente
    WHERE tenant_id = p_tenant_id AND proveedor_id = v_loser
    LIMIT 1;

    IF v_loser_cc IS NULL THEN
      CONTINUE;
    END IF;

    IF v_surv_cc IS NOT NULL THEN
      UPDATE public.cuenta_corriente
      SET saldo = saldo + COALESCE(v_saldo_l, 0),
          updated_at = now()
      WHERE id = v_surv_cc;

      DELETE FROM public.cuenta_corriente WHERE id = v_loser_cc;
    ELSE
      UPDATE public.cuenta_corriente
      SET proveedor_id = p_survivor_id,
          updated_at = now()
      WHERE id = v_loser_cc;
    END IF;
  END LOOP;

  UPDATE public.producto p
  SET proveedor_id = p_survivor_id
  WHERE p.tenant_id = p_tenant_id
    AND p.proveedor_id = ANY (v_losers);

  UPDATE public.comprobante c
  SET proveedor_id = p_survivor_id
  WHERE c.tenant_id = p_tenant_id
    AND c.proveedor_id = ANY (v_losers);

  UPDATE public.importacion_log il
  SET proveedor_id = p_survivor_id
  WHERE il.tenant_id = p_tenant_id
    AND il.proveedor_id = ANY (v_losers);

  UPDATE public.importacion_borrador ib
  SET proveedor_id = p_survivor_id
  WHERE ib.tenant_id = p_tenant_id
    AND ib.proveedor_id = ANY (v_losers);

  UPDATE public.movimiento m
  SET proveedor_id = p_survivor_id
  WHERE m.tenant_id = p_tenant_id
    AND m.proveedor_id = ANY (v_losers);

  UPDATE public.producto_lote_ingreso pli
  SET proveedor_id = p_survivor_id
  WHERE pli.tenant_id = p_tenant_id
    AND pli.proveedor_id = ANY (v_losers);

  UPDATE public.pago_proveedor_factura ppf
  SET proveedor_id = p_survivor_id
  WHERE ppf.tenant_id = p_tenant_id
    AND ppf.proveedor_id = ANY (v_losers);

  DELETE FROM public.proveedor p
  WHERE p.tenant_id = p_tenant_id
    AND p.id = ANY (v_losers);

  RETURN jsonb_build_object(
    'dry_run', false,
    'survivor_id', p_survivor_id,
    'merged_proveedor_ids', to_jsonb(v_losers)
  );
END;
$$;

COMMENT ON FUNCTION public.fusionar_proveedores(uuid, uuid, uuid[], boolean) IS
  'Fusiona proveedores duplicados en p_survivor_id (Nest): repunta FKs del esquema actual, consolida cuenta corriente.';
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP FUNCTION IF EXISTS public.fusionar_proveedores(uuid, uuid, uuid[], boolean);`);
  }
}
