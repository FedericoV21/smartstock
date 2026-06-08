-- RPC transaccional: fusiona uno o más proveedores "perdedores" en un proveedor superviviente del mismo tenant.
-- Repunta FKs (incl. movimiento y producto_lote_ingreso, ausentes en la migración 103), deduplica producto_proveedor
-- y consolida cuenta_corriente como en 103_proveedor_tenant_scope.sql.

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
  v_claim UUID;
  v_loser UUID;
  v_loser_cc UUID;
  v_surv_cc UUID;
  v_saldo_l NUMERIC;
  v_dup_pp INT;
  v_producto_pp INT;
BEGIN
  v_claim := public.current_tenant_id();
  IF v_claim IS NULL OR v_claim IS DISTINCT FROM p_tenant_id THEN
    RAISE EXCEPTION 'Operación no autorizada para este tenant';
  END IF;

  IF p_survivor_id IS NULL THEN
    RAISE EXCEPTION 'Indicá el proveedor destino';
  END IF;

  IF p_loser_ids IS NULL OR coalesce(array_length(p_loser_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Indicá al menos un proveedor a fusionar';
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
    RAISE EXCEPTION 'Algún proveedor a fusionar no existe en el tenant';
  END IF;

  IF p_dry_run THEN
    SELECT count(*)::int INTO v_dup_pp
    FROM public.producto_proveedor pp
    INNER JOIN public.producto_proveedor pp2
      ON pp2.tenant_id = pp.tenant_id
     AND pp2.producto_id = pp.producto_id
     AND pp2.proveedor_id = p_survivor_id
    WHERE pp.tenant_id = p_tenant_id
      AND pp.proveedor_id = ANY (v_losers);

    SELECT count(*)::int INTO v_producto_pp
    FROM public.producto_proveedor pp
    WHERE pp.tenant_id = p_tenant_id
      AND pp.proveedor_id = ANY (v_losers);

    RETURN jsonb_build_object(
      'dry_run', true,
      'survivor_id', p_survivor_id,
      'loser_ids', to_jsonb(v_losers),
      'counts', jsonb_build_object(
        'producto', (SELECT count(*)::int FROM public.producto WHERE tenant_id = p_tenant_id AND proveedor_id = ANY (v_losers)),
        'producto_proveedor_rows', v_producto_pp,
        'producto_proveedor_duplicate_junction_removed', v_dup_pp,
        'lista_precios', (SELECT count(*)::int FROM public.lista_precios WHERE tenant_id = p_tenant_id AND proveedor_id = ANY (v_losers)),
        'comprobante', (SELECT count(*)::int FROM public.comprobante WHERE tenant_id = p_tenant_id AND proveedor_id = ANY (v_losers)),
        'importacion_log', (SELECT count(*)::int FROM public.importacion_log WHERE tenant_id = p_tenant_id AND proveedor_id = ANY (v_losers)),
        'lector_factura_log', (SELECT count(*)::int FROM public.lector_factura_log WHERE tenant_id = p_tenant_id AND proveedor_id = ANY (v_losers)),
        'movimiento', (SELECT count(*)::int FROM public.movimiento WHERE tenant_id = p_tenant_id AND proveedor_id = ANY (v_losers)),
        'producto_lote_ingreso', (SELECT count(*)::int FROM public.producto_lote_ingreso WHERE tenant_id = p_tenant_id AND proveedor_id = ANY (v_losers)),
        'pago', (SELECT count(*)::int FROM public.pago WHERE tenant_id = p_tenant_id AND proveedor_id = ANY (v_losers)),
        'pago_proveedor_factura', (SELECT count(*)::int FROM public.pago_proveedor_factura WHERE tenant_id = p_tenant_id AND proveedor_id = ANY (v_losers)),
        'whatsapp_branch_rule', (SELECT count(*)::int FROM public.whatsapp_branch_rule WHERE tenant_id = p_tenant_id AND proveedor_id = ANY (v_losers))
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
      UPDATE public.pago
      SET cuenta_id = v_surv_cc
      WHERE cuenta_id = v_loser_cc;

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

  DELETE FROM public.producto_proveedor pp
  USING public.producto_proveedor pp2
  WHERE pp.tenant_id = p_tenant_id
    AND pp.proveedor_id = ANY (v_losers)
    AND pp2.tenant_id = pp.tenant_id
    AND pp2.producto_id = pp.producto_id
    AND pp2.proveedor_id = p_survivor_id;

  UPDATE public.producto_proveedor pp
  SET proveedor_id = p_survivor_id
  WHERE pp.tenant_id = p_tenant_id
    AND pp.proveedor_id = ANY (v_losers);

  UPDATE public.producto p
  SET proveedor_id = p_survivor_id
  WHERE p.tenant_id = p_tenant_id
    AND p.proveedor_id = ANY (v_losers);

  UPDATE public.lista_precios lp
  SET proveedor_id = p_survivor_id
  WHERE lp.tenant_id = p_tenant_id
    AND lp.proveedor_id = ANY (v_losers);

  UPDATE public.comprobante c
  SET proveedor_id = p_survivor_id
  WHERE c.tenant_id = p_tenant_id
    AND c.proveedor_id = ANY (v_losers);

  UPDATE public.importacion_log il
  SET proveedor_id = p_survivor_id
  WHERE il.tenant_id = p_tenant_id
    AND il.proveedor_id = ANY (v_losers);

  UPDATE public.lector_factura_log lfl
  SET proveedor_id = p_survivor_id
  WHERE lfl.tenant_id = p_tenant_id
    AND lfl.proveedor_id = ANY (v_losers);

  UPDATE public.movimiento m
  SET proveedor_id = p_survivor_id
  WHERE m.tenant_id = p_tenant_id
    AND m.proveedor_id = ANY (v_losers);

  UPDATE public.producto_lote_ingreso pli
  SET proveedor_id = p_survivor_id
  WHERE pli.tenant_id = p_tenant_id
    AND pli.proveedor_id = ANY (v_losers);

  UPDATE public.pago pg
  SET proveedor_id = p_survivor_id
  WHERE pg.tenant_id = p_tenant_id
    AND pg.proveedor_id = ANY (v_losers);

  UPDATE public.pago_proveedor_factura ppf
  SET proveedor_id = p_survivor_id
  WHERE ppf.tenant_id = p_tenant_id
    AND ppf.proveedor_id = ANY (v_losers);

  UPDATE public.whatsapp_branch_rule wbr
  SET proveedor_id = p_survivor_id
  WHERE wbr.tenant_id = p_tenant_id
    AND wbr.proveedor_id = ANY (v_losers);

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
  'Fusiona proveedores duplicados en p_survivor_id: repunta FKs, deduplica producto_proveedor, consolida cuenta corriente. Requiere JWT tenant_id = p_tenant_id.';

REVOKE ALL ON FUNCTION public.fusionar_proveedores(uuid, uuid, uuid[], boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fusionar_proveedores(uuid, uuid, uuid[], boolean) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
