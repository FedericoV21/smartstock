import { MigrationInterface, QueryRunner } from 'typeorm';

export class NbCc003RpcsSchema1750060000000 implements MigrationInterface {
  name = 'NbCc003RpcsSchema1750060000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.actualizar_pago_cliente_extracto(
        p_tenant_id UUID,
        p_pago_id UUID,
        p_monto NUMERIC,
        p_fecha DATE,
        p_tipo_pago public.tipo_pago DEFAULT 'efectivo'::public.tipo_pago,
        p_referencia TEXT DEFAULT NULL,
        p_notas TEXT DEFAULT NULL
      )
      RETURNS JSONB
      LANGUAGE plpgsql
      AS $$
      DECLARE
        v_pago         public.pago%ROWTYPE;
        v_delta        NUMERIC(18, 6);
        v_cob          public.cobranza_factura%ROWTYPE;
        v_new_pend     NUMERIC(18, 6);
        v_cob_pago_id  UUID;
        v_tol          NUMERIC := 0.01;
      BEGIN
        IF p_tenant_id IS NULL OR p_pago_id IS NULL OR p_monto IS NULL OR p_monto <= 0 THEN
          RAISE EXCEPTION 'tenant_id, pago_id y monto (> 0) son requeridos';
        END IF;
        IF p_fecha IS NULL THEN
          RAISE EXCEPTION 'La fecha es requerida';
        END IF;

        SELECT * INTO v_pago
        FROM public.pago
        WHERE id = p_pago_id AND tenant_id = p_tenant_id
        FOR UPDATE;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Pago no encontrado';
        END IF;
        IF v_pago.proveedor_id IS NOT NULL THEN
          RAISE EXCEPTION 'Este pago no es de un cliente';
        END IF;

        v_delta := p_monto - v_pago.monto;

        IF v_pago.comprobante_id IS NOT NULL AND ABS(v_delta) > v_tol THEN
          SELECT * INTO v_cob
          FROM public.cobranza_factura
          WHERE tenant_id = p_tenant_id AND comprobante_id = v_pago.comprobante_id
          FOR UPDATE;

          IF FOUND THEN
            v_new_pend := v_cob.saldo_pendiente - v_delta;
            IF v_new_pend < -v_tol THEN
              RAISE EXCEPTION 'El nuevo monto dejaría saldo pendiente negativo en la factura';
            END IF;
            IF v_new_pend > v_cob.monto_original + v_tol THEN
              RAISE EXCEPTION 'El nuevo monto supera el total de la factura';
            END IF;

            UPDATE public.cobranza_factura
            SET saldo_pendiente = GREATEST(0, v_new_pend), updated_at = now()
            WHERE id = v_cob.id;

            SELECT cp.id INTO v_cob_pago_id
            FROM public.cobranza_pago cp
            WHERE cp.tenant_id = p_tenant_id
              AND cp.cobranza_factura_id = v_cob.id
              AND cp.fecha = v_pago.fecha
              AND ABS(cp.monto - v_pago.monto) <= v_tol
            ORDER BY cp.created_at DESC
            LIMIT 1;

            IF v_cob_pago_id IS NOT NULL THEN
              UPDATE public.cobranza_pago
              SET monto = p_monto, tipo_pago = p_tipo_pago, fecha = p_fecha, notas = p_notas
              WHERE id = v_cob_pago_id;
            END IF;
          END IF;
        END IF;

        IF ABS(v_delta) > v_tol AND v_pago.cuenta_id IS NOT NULL THEN
          UPDATE public.cuenta_corriente
          SET saldo = saldo - v_delta
          WHERE id = v_pago.cuenta_id AND tenant_id = p_tenant_id;
        END IF;

        UPDATE public.pago
        SET
          monto = p_monto,
          fecha = p_fecha,
          tipo_pago = p_tipo_pago,
          referencia = NULLIF(TRIM(p_referencia), ''),
          notas = NULLIF(TRIM(p_notas), '')
        WHERE id = p_pago_id;

        RETURN jsonb_build_object('ok', true, 'pago_id', p_pago_id, 'delta', v_delta);
      END;
      $$;

      CREATE OR REPLACE FUNCTION public.revertir_movimiento_tesoreria_por_pago(
        p_tenant_id UUID,
        p_pago_id UUID
      )
      RETURNS jsonb
      LANGUAGE plpgsql
      AS $$
      DECLARE
        v_mov public.caja_tesoreria_movimiento;
        v_cheque public.caja_tesoreria_cheque;
        v_comp public.caja_tesoreria_movimiento;
        v_comp_id UUID := NULL;
      BEGIN
        SELECT * INTO v_mov
        FROM public.caja_tesoreria_movimiento
        WHERE tenant_id = p_tenant_id
          AND pago_id = p_pago_id
          AND es_ingreso = false
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE;

        IF v_mov IS NULL THEN
          RETURN jsonb_build_object('revertido', false, 'motivo', 'sin_movimiento_tesoreria');
        END IF;

        IF v_mov.cheque_id IS NOT NULL THEN
          SELECT * INTO v_cheque
          FROM public.caja_tesoreria_cheque
          WHERE id = v_mov.cheque_id AND tenant_id = p_tenant_id
          FOR UPDATE;

          IF v_cheque IS NULL THEN
            RAISE EXCEPTION 'Cheque asociado no encontrado';
          END IF;
          IF v_cheque.estado = 'depositado' THEN
            RAISE EXCEPTION 'No se puede revertir: el cheque ya fue depositado';
          END IF;

          UPDATE public.caja_tesoreria_cheque
          SET estado = 'en_cartera', movimiento_egreso_id = NULL, pago_id = NULL, updated_at = now()
          WHERE id = v_cheque.id;
        ELSIF v_mov.tipo IN ('pago_proveedor', 'egreso_efectivo') THEN
          INSERT INTO public.caja_tesoreria_movimiento (
            tenant_id, caja_tesoreria_id, tipo, monto, es_ingreso, pago_id, proveedor_id, notas, usuario_id, fecha
          ) VALUES (
            p_tenant_id, v_mov.caja_tesoreria_id, 'ajuste', v_mov.monto, true, p_pago_id,
            v_mov.proveedor_id, 'Reversión de pago a proveedor', v_mov.usuario_id, CURRENT_DATE
          )
          RETURNING * INTO v_comp;
          v_comp_id := v_comp.id;
        END IF;

        RETURN jsonb_build_object('revertido', true, 'movimiento_id', v_mov.id, 'compensacion_id', v_comp_id);
      END;
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP FUNCTION IF EXISTS public.revertir_movimiento_tesoreria_por_pago(uuid, uuid);
      DROP FUNCTION IF EXISTS public.actualizar_pago_cliente_extracto(uuid, uuid, numeric, date, public.tipo_pago, text, text);
    `);
  }
}
