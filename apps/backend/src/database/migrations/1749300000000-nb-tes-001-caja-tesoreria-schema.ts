import { MigrationInterface, QueryRunner } from 'typeorm';

export class NbTes001CajaTesoreriaSchema1749300000000 implements MigrationInterface {
  name = 'NbTes001CajaTesoreriaSchema1749300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE public.caja_tesoreria_movimiento_tipo AS ENUM (
        'ingreso_efectivo',
        'egreso_efectivo',
        'ingreso_cheque',
        'egreso_cheque',
        'pago_proveedor',
        'ajuste',
        'transferencia_desde_caja'
      );

      CREATE TYPE public.caja_tesoreria_cheque_estado AS ENUM (
        'en_cartera',
        'depositado',
        'entregado',
        'rechazado'
      );

      CREATE TABLE public.caja_tesoreria (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
        sucursal_id uuid REFERENCES public.sucursal(id) ON DELETE CASCADE,
        nombre text NOT NULL DEFAULT 'Caja interna',
        activa boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_caja_tesoreria_nombre_not_blank CHECK (btrim(nombre) <> '')
      );

      CREATE UNIQUE INDEX uk_caja_tesoreria_tenant_central
        ON public.caja_tesoreria (tenant_id)
        WHERE sucursal_id IS NULL;

      CREATE UNIQUE INDEX uk_caja_tesoreria_tenant_sucursal
        ON public.caja_tesoreria (tenant_id, sucursal_id)
        WHERE sucursal_id IS NOT NULL;

      CREATE INDEX idx_caja_tesoreria_tenant ON public.caja_tesoreria (tenant_id);

      CREATE TABLE public.caja_tesoreria_movimiento (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
        caja_tesoreria_id uuid NOT NULL REFERENCES public.caja_tesoreria(id) ON DELETE RESTRICT,
        tipo public.caja_tesoreria_movimiento_tipo NOT NULL,
        monto numeric(14, 2) NOT NULL,
        es_ingreso boolean NOT NULL,
        cierre_z_id uuid,
        caja_id uuid,
        pago_id uuid REFERENCES public.pago(id) ON DELETE SET NULL,
        cheque_id uuid,
        proveedor_id uuid REFERENCES public.proveedor(id) ON DELETE SET NULL,
        notas text,
        usuario_id uuid,
        fecha date NOT NULL DEFAULT CURRENT_DATE,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_caja_tesoreria_mov_monto_pos CHECK (monto > 0)
      );

      CREATE INDEX idx_caja_tesoreria_mov_caja
        ON public.caja_tesoreria_movimiento (caja_tesoreria_id, created_at DESC);

      CREATE TABLE public.caja_tesoreria_cheque (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
        caja_tesoreria_id uuid NOT NULL REFERENCES public.caja_tesoreria(id) ON DELETE RESTRICT,
        numero text NOT NULL,
        banco text NOT NULL,
        titular text,
        fecha_emision date,
        fecha_cobro date,
        monto numeric(14, 2) NOT NULL,
        estado public.caja_tesoreria_cheque_estado NOT NULL DEFAULT 'en_cartera',
        movimiento_ingreso_id uuid NOT NULL REFERENCES public.caja_tesoreria_movimiento(id) ON DELETE RESTRICT,
        movimiento_egreso_id uuid REFERENCES public.caja_tesoreria_movimiento(id) ON DELETE SET NULL,
        pago_id uuid REFERENCES public.pago(id) ON DELETE SET NULL,
        notas text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_caja_tesoreria_cheque_monto_pos CHECK (monto > 0)
      );

      ALTER TABLE public.caja_tesoreria_movimiento
        ADD CONSTRAINT fk_caja_tesoreria_mov_cheque
        FOREIGN KEY (cheque_id) REFERENCES public.caja_tesoreria_cheque(id) ON DELETE SET NULL;

      CREATE INDEX idx_caja_tesoreria_cheque_caja_estado
        ON public.caja_tesoreria_cheque (caja_tesoreria_id, estado);
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.saldo_efectivo_caja_tesoreria(p_caja_tesoreria_id uuid)
      RETURNS numeric
      LANGUAGE sql
      STABLE
      AS $$
        SELECT COALESCE(
          SUM(CASE WHEN es_ingreso THEN monto ELSE -monto END),
          0
        )
        FROM public.caja_tesoreria_movimiento
        WHERE caja_tesoreria_id = p_caja_tesoreria_id
          AND tipo IN (
            'ingreso_efectivo',
            'egreso_efectivo',
            'pago_proveedor',
            'ajuste',
            'transferencia_desde_caja'
          );
      $$;

      CREATE OR REPLACE FUNCTION public.saldo_disponible_cheque_tesoreria(p_cheque_id uuid)
      RETURNS numeric
      LANGUAGE sql
      STABLE
      AS $$
        SELECT GREATEST(
          c.monto - COALESCE(
            (
              SELECT SUM(CASE WHEN m.es_ingreso THEN -m.monto ELSE m.monto END)
              FROM public.caja_tesoreria_movimiento m
              WHERE m.cheque_id = p_cheque_id
                AND m.tipo IN ('egreso_cheque', 'ajuste')
            ),
            0
          ),
          0
        )
        FROM public.caja_tesoreria_cheque c
        WHERE c.id = p_cheque_id;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.registrar_pago_proveedor_obligacion(
        p_tenant_id uuid,
        p_pago_proveedor_factura_id uuid,
        p_monto numeric,
        p_tipo_pago public.tipo_pago DEFAULT 'efectivo',
        p_notas text DEFAULT NULL,
        p_usuario_id uuid DEFAULT NULL,
        p_fecha date DEFAULT NULL
      )
      RETURNS jsonb
      LANGUAGE plpgsql
      AS $$
      DECLARE
        v_row public.pago_proveedor_factura%ROWTYPE;
        v_monto_aplicado numeric(18, 6);
        v_saldo_a_favor numeric(18, 6);
        v_new numeric(18, 6);
        v_new_ven timestamptz;
        v_pago_m uuid;
        v_pago_cc public.pago;
        v_fecha date := COALESCE(p_fecha, CURRENT_DATE);
        v_nuevo text;
      BEGIN
        IF p_monto IS NULL OR p_monto <= 0 THEN
          RAISE EXCEPTION 'El monto del pago debe ser mayor a cero';
        END IF;

        SELECT * INTO v_row
        FROM public.pago_proveedor_factura
        WHERE id = p_pago_proveedor_factura_id AND tenant_id = p_tenant_id
        FOR UPDATE;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Obligacion a proveedor no encontrada';
        END IF;
        IF v_row.estado = 'anulada' THEN
          RAISE EXCEPTION 'Obligacion anulada';
        END IF;

        v_monto_aplicado := LEAST(p_monto, GREATEST(v_row.saldo_pendiente, 0));
        v_saldo_a_favor := p_monto - v_monto_aplicado;
        v_new := GREATEST(v_row.saldo_pendiente - v_monto_aplicado, 0);

        IF v_new > 0 THEN
          v_new_ven := now() + interval '7 days';
        ELSE
          v_new_ven := v_row.vencimiento_at;
        END IF;

        IF v_new = 0 THEN v_nuevo := 'pagada';
        ELSIF v_new < v_row.monto_original THEN v_nuevo := 'parcial';
        ELSE v_nuevo := 'pendiente';
        END IF;

        UPDATE public.pago_proveedor_factura
        SET saldo_pendiente = v_new, vencimiento_at = v_new_ven, estado = v_nuevo, updated_at = now()
        WHERE id = v_row.id;

        INSERT INTO public.pago_proveedor_movimiento (
          tenant_id, pago_proveedor_factura_id, monto, tipo_pago, fecha, usuario_id, notas
        ) VALUES (
          p_tenant_id, v_row.id, p_monto, p_tipo_pago, v_fecha, p_usuario_id, p_notas
        ) RETURNING id INTO v_pago_m;

        v_pago_cc := public.registrar_pago_cuenta_proveedor(
          p_tenant_id, v_row.proveedor_id, p_monto, p_tipo_pago,
          v_row.comprobante_id, NULL, p_notas, p_usuario_id, v_fecha
        );

        RETURN jsonb_build_object(
          'pago_proveedor_movimiento_id', v_pago_m,
          'nuevo_saldo', v_new,
          'monto_aplicado', v_monto_aplicado,
          'saldo_a_favor_generado', v_saldo_a_favor,
          'pago_cuenta_corriente_id', v_pago_cc.id
        );
      END;
      $$;
    `);

    await queryRunner.query(this.registrarIngresoEfectivoSql());
    await queryRunner.query(this.registrarChequeSql());
    await queryRunner.query(this.registrarTransferenciaSql());
    await queryRunner.query(this.cambiarEstadoChequeSql());
    await queryRunner.query(this.registrarPagoProveedorTesoreriaSql());
    await queryRunner.query(this.provisionarCajasSql());
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP FUNCTION IF EXISTS public.provisionar_cajas_tesoreria(uuid, text);
      DROP FUNCTION IF EXISTS public.revertir_movimiento_tesoreria_por_pago(uuid, uuid);
      DROP FUNCTION IF EXISTS public.registrar_pago_proveedor_tesoreria(uuid, uuid, uuid, numeric, public.tipo_pago, uuid, uuid, text, uuid, date);
      DROP FUNCTION IF EXISTS public.cambiar_estado_cheque_tesoreria(uuid, uuid, public.caja_tesoreria_cheque_estado, text, uuid);
      DROP FUNCTION IF EXISTS public.registrar_transferencia_desde_caja_tesoreria(uuid, uuid, numeric, uuid, uuid, text, uuid, date);
      DROP FUNCTION IF EXISTS public.registrar_cheque_tesoreria(uuid, uuid, text, text, text, date, date, numeric, text, uuid, date);
      DROP FUNCTION IF EXISTS public.registrar_ingreso_efectivo_tesoreria(uuid, uuid, numeric, text, uuid, date);
      DROP FUNCTION IF EXISTS public.registrar_pago_proveedor_obligacion(uuid, uuid, numeric, public.tipo_pago, text, uuid, date);
      DROP FUNCTION IF EXISTS public.saldo_disponible_cheque_tesoreria(uuid);
      DROP FUNCTION IF EXISTS public.saldo_efectivo_caja_tesoreria(uuid);
      DROP TABLE IF EXISTS public.caja_tesoreria_cheque CASCADE;
      DROP TABLE IF EXISTS public.caja_tesoreria_movimiento CASCADE;
      DROP TABLE IF EXISTS public.caja_tesoreria CASCADE;
      DROP TYPE IF EXISTS public.caja_tesoreria_cheque_estado CASCADE;
      DROP TYPE IF EXISTS public.caja_tesoreria_movimiento_tipo CASCADE;
    `);
  }

  private registrarIngresoEfectivoSql(): string {
    return `
      CREATE OR REPLACE FUNCTION public.registrar_ingreso_efectivo_tesoreria(
        p_tenant_id uuid, p_caja_tesoreria_id uuid, p_monto numeric,
        p_notas text DEFAULT NULL, p_usuario_id uuid DEFAULT NULL, p_fecha date DEFAULT NULL
      )
      RETURNS public.caja_tesoreria_movimiento
      LANGUAGE plpgsql AS $$
      DECLARE v_caja public.caja_tesoreria; v_mov public.caja_tesoreria_movimiento;
      BEGIN
        IF p_monto IS NULL OR p_monto <= 0 THEN RAISE EXCEPTION 'El monto debe ser mayor a cero'; END IF;
        SELECT * INTO v_caja FROM public.caja_tesoreria
          WHERE id = p_caja_tesoreria_id AND tenant_id = p_tenant_id AND activa = true;
        IF v_caja IS NULL THEN RAISE EXCEPTION 'Caja de tesorer├¡a no encontrada o inactiva'; END IF;
        INSERT INTO public.caja_tesoreria_movimiento (
          tenant_id, caja_tesoreria_id, tipo, monto, es_ingreso, notas, usuario_id, fecha
        ) VALUES (
          p_tenant_id, p_caja_tesoreria_id, 'ingreso_efectivo', p_monto, true,
          p_notas, p_usuario_id, COALESCE(p_fecha, CURRENT_DATE)
        ) RETURNING * INTO v_mov;
        RETURN v_mov;
      END; $$;
    `;
  }

  private registrarChequeSql(): string {
    return `
      CREATE OR REPLACE FUNCTION public.registrar_cheque_tesoreria(
        p_tenant_id uuid, p_caja_tesoreria_id uuid, p_numero text, p_banco text,
        p_titular text DEFAULT NULL, p_fecha_emision date DEFAULT NULL, p_fecha_cobro date DEFAULT NULL,
        p_monto numeric DEFAULT NULL, p_notas text DEFAULT NULL, p_usuario_id uuid DEFAULT NULL, p_fecha date DEFAULT NULL
      )
      RETURNS jsonb LANGUAGE plpgsql AS $$
      DECLARE v_caja public.caja_tesoreria; v_mov public.caja_tesoreria_movimiento; v_cheque public.caja_tesoreria_cheque;
      BEGIN
        IF p_monto IS NULL OR p_monto <= 0 THEN RAISE EXCEPTION 'El monto del cheque debe ser mayor a cero'; END IF;
        IF p_numero IS NULL OR btrim(p_numero) = '' THEN RAISE EXCEPTION 'El n├║mero de cheque es obligatorio'; END IF;
        IF p_banco IS NULL OR btrim(p_banco) = '' THEN RAISE EXCEPTION 'El banco es obligatorio'; END IF;
        SELECT * INTO v_caja FROM public.caja_tesoreria
          WHERE id = p_caja_tesoreria_id AND tenant_id = p_tenant_id AND activa = true;
        IF v_caja IS NULL THEN RAISE EXCEPTION 'Caja de tesorer├¡a no encontrada o inactiva'; END IF;
        INSERT INTO public.caja_tesoreria_movimiento (
          tenant_id, caja_tesoreria_id, tipo, monto, es_ingreso, notas, usuario_id, fecha
        ) VALUES (
          p_tenant_id, p_caja_tesoreria_id, 'ingreso_cheque', p_monto, true,
          p_notas, p_usuario_id, COALESCE(p_fecha, CURRENT_DATE)
        ) RETURNING * INTO v_mov;
        INSERT INTO public.caja_tesoreria_cheque (
          tenant_id, caja_tesoreria_id, numero, banco, titular, fecha_emision, fecha_cobro,
          monto, estado, movimiento_ingreso_id, notas
        ) VALUES (
          p_tenant_id, p_caja_tesoreria_id, btrim(p_numero), btrim(p_banco),
          NULLIF(btrim(COALESCE(p_titular, '')), ''), p_fecha_emision, p_fecha_cobro,
          p_monto, 'en_cartera', v_mov.id, p_notas
        ) RETURNING * INTO v_cheque;
        UPDATE public.caja_tesoreria_movimiento SET cheque_id = v_cheque.id WHERE id = v_mov.id;
        RETURN jsonb_build_object('movimiento_id', v_mov.id, 'cheque_id', v_cheque.id);
      END; $$;
    `;
  }

  private registrarTransferenciaSql(): string {
    return `
      CREATE OR REPLACE FUNCTION public.registrar_transferencia_desde_caja_tesoreria(
        p_tenant_id uuid, p_caja_tesoreria_id uuid, p_monto numeric,
        p_cierre_z_id uuid DEFAULT NULL, p_caja_id uuid DEFAULT NULL,
        p_notas text DEFAULT NULL, p_usuario_id uuid DEFAULT NULL, p_fecha date DEFAULT NULL
      )
      RETURNS public.caja_tesoreria_movimiento LANGUAGE plpgsql AS $$
      DECLARE v_caja public.caja_tesoreria; v_mov public.caja_tesoreria_movimiento;
      BEGIN
        IF p_monto IS NULL OR p_monto <= 0 THEN RAISE EXCEPTION 'El monto debe ser mayor a cero'; END IF;
        SELECT * INTO v_caja FROM public.caja_tesoreria
          WHERE id = p_caja_tesoreria_id AND tenant_id = p_tenant_id AND activa = true;
        IF v_caja IS NULL THEN RAISE EXCEPTION 'Caja de tesorer├¡a no encontrada o inactiva'; END IF;
        INSERT INTO public.caja_tesoreria_movimiento (
          tenant_id, caja_tesoreria_id, tipo, monto, es_ingreso,
          cierre_z_id, caja_id, notas, usuario_id, fecha
        ) VALUES (
          p_tenant_id, p_caja_tesoreria_id, 'transferencia_desde_caja', p_monto, true,
          p_cierre_z_id, p_caja_id, p_notas, p_usuario_id, COALESCE(p_fecha, CURRENT_DATE)
        ) RETURNING * INTO v_mov;
        RETURN v_mov;
      END; $$;
    `;
  }

  private cambiarEstadoChequeSql(): string {
    return `
      CREATE OR REPLACE FUNCTION public.cambiar_estado_cheque_tesoreria(
        p_tenant_id uuid, p_cheque_id uuid, p_estado public.caja_tesoreria_cheque_estado,
        p_notas text DEFAULT NULL, p_usuario_id uuid DEFAULT NULL
      )
      RETURNS public.caja_tesoreria_cheque LANGUAGE plpgsql AS $$
      DECLARE v_cheque public.caja_tesoreria_cheque; v_saldo numeric;
      BEGIN
        IF p_estado NOT IN ('depositado', 'rechazado') THEN
          RAISE EXCEPTION 'Solo se puede cambiar a depositado o rechazado desde este RPC';
        END IF;
        SELECT * INTO v_cheque FROM public.caja_tesoreria_cheque
          WHERE id = p_cheque_id AND tenant_id = p_tenant_id FOR UPDATE;
        IF v_cheque IS NULL THEN RAISE EXCEPTION 'Cheque no encontrado'; END IF;
        IF v_cheque.estado <> 'en_cartera' THEN RAISE EXCEPTION 'Solo se puede cambiar el estado de cheques en cartera'; END IF;
        v_saldo := public.saldo_disponible_cheque_tesoreria(p_cheque_id);
        IF v_saldo + 0.01 < v_cheque.monto THEN
          RAISE EXCEPTION 'No se puede depositar o rechazar un cheque con pagos imputados';
        END IF;
        UPDATE public.caja_tesoreria_cheque
        SET estado = p_estado, notas = COALESCE(p_notas, notas), updated_at = now()
        WHERE id = p_cheque_id RETURNING * INTO v_cheque;
        RETURN v_cheque;
      END; $$;
    `;
  }

  private registrarPagoProveedorTesoreriaSql(): string {
    return `
      CREATE OR REPLACE FUNCTION public.registrar_pago_proveedor_tesoreria(
        p_tenant_id uuid, p_caja_tesoreria_id uuid, p_proveedor_id uuid, p_monto numeric,
        p_tipo_pago public.tipo_pago DEFAULT 'efectivo', p_cheque_id uuid DEFAULT NULL,
        p_pago_proveedor_factura_id uuid DEFAULT NULL, p_notas text DEFAULT NULL,
        p_usuario_id uuid DEFAULT NULL, p_fecha date DEFAULT NULL
      )
      RETURNS jsonb LANGUAGE plpgsql AS $$
      DECLARE
        v_caja public.caja_tesoreria; v_saldo numeric; v_cheque public.caja_tesoreria_cheque;
        v_pago_result jsonb; v_pago_id uuid; v_mov public.caja_tesoreria_movimiento;
        v_fecha date := COALESCE(p_fecha, CURRENT_DATE);
        v_tipo_mov public.caja_tesoreria_movimiento_tipo;
      BEGIN
        IF p_monto IS NULL OR p_monto <= 0 THEN RAISE EXCEPTION 'El monto debe ser mayor a cero'; END IF;
        SELECT * INTO v_caja FROM public.caja_tesoreria
          WHERE id = p_caja_tesoreria_id AND tenant_id = p_tenant_id AND activa = true;
        IF v_caja IS NULL THEN RAISE EXCEPTION 'Caja de tesorer├¡a no encontrada o inactiva'; END IF;

        IF p_tipo_pago = 'efectivo' THEN
          v_saldo := public.saldo_efectivo_caja_tesoreria(p_caja_tesoreria_id);
          IF v_saldo + 0.000001 < p_monto THEN
            RAISE EXCEPTION 'Saldo de efectivo insuficiente en tesorer├¡a (disponible: %)', v_saldo;
          END IF;
          v_tipo_mov := 'pago_proveedor';
        ELSIF p_tipo_pago = 'cheque' THEN
          IF p_cheque_id IS NULL THEN RAISE EXCEPTION 'Debe indicar el cheque a utilizar'; END IF;
          SELECT * INTO v_cheque FROM public.caja_tesoreria_cheque
            WHERE id = p_cheque_id AND tenant_id = p_tenant_id AND caja_tesoreria_id = p_caja_tesoreria_id FOR UPDATE;
          IF v_cheque IS NULL THEN RAISE EXCEPTION 'Cheque no encontrado en esta tesorer├¡a'; END IF;
          IF v_cheque.estado <> 'en_cartera' THEN RAISE EXCEPTION 'El cheque no est├í disponible en cartera'; END IF;
          v_saldo := public.saldo_disponible_cheque_tesoreria(p_cheque_id);
          IF p_monto > v_saldo + 0.01 THEN RAISE EXCEPTION 'Saldo del cheque insuficiente (disponible: %)', v_saldo; END IF;
          v_tipo_mov := 'egreso_cheque';
        ELSE
          RAISE EXCEPTION 'Solo se admiten pagos en efectivo o cheque desde tesorer├¡a';
        END IF;

        IF p_pago_proveedor_factura_id IS NOT NULL THEN
          v_pago_result := public.registrar_pago_proveedor_obligacion(
            p_tenant_id, p_pago_proveedor_factura_id, p_monto, p_tipo_pago, p_notas, p_usuario_id, v_fecha
          );
          v_pago_id := (v_pago_result->>'pago_cuenta_corriente_id')::uuid;
        ELSE
          v_pago_id := (
            public.registrar_pago_cuenta_proveedor(
              p_tenant_id, p_proveedor_id, p_monto, p_tipo_pago,
              NULL, NULL, p_notas, p_usuario_id, v_fecha
            )
          ).id;
        END IF;

        INSERT INTO public.caja_tesoreria_movimiento (
          tenant_id, caja_tesoreria_id, tipo, monto, es_ingreso,
          pago_id, cheque_id, proveedor_id, notas, usuario_id, fecha
        ) VALUES (
          p_tenant_id, p_caja_tesoreria_id, v_tipo_mov, p_monto, false,
          v_pago_id, p_cheque_id, p_proveedor_id, p_notas, p_usuario_id, v_fecha
        ) RETURNING * INTO v_mov;

        IF p_tipo_pago = 'cheque' AND p_cheque_id IS NOT NULL THEN
          v_saldo := public.saldo_disponible_cheque_tesoreria(p_cheque_id);
          IF v_saldo <= 0.01 THEN
            UPDATE public.caja_tesoreria_cheque
            SET estado = 'entregado', movimiento_egreso_id = v_mov.id, pago_id = v_pago_id, updated_at = now()
            WHERE id = p_cheque_id;
          ELSE
            UPDATE public.caja_tesoreria_cheque SET updated_at = now() WHERE id = p_cheque_id;
          END IF;
        END IF;

        RETURN jsonb_build_object(
          'movimiento_id', v_mov.id, 'pago_id', v_pago_id,
          'pago_proveedor', v_pago_result,
          'saldo_cheque_restante', CASE WHEN p_cheque_id IS NOT NULL THEN v_saldo ELSE NULL END
        );
      END; $$;
    `;
  }

  private provisionarCajasSql(): string {
    return `
      CREATE OR REPLACE FUNCTION public.provisionar_cajas_tesoreria(p_tenant_id uuid, p_alcance text)
      RETURNS jsonb LANGUAGE plpgsql AS $$
      DECLARE v_count int := 0; v_sucursal record;
      BEGIN
        IF p_alcance NOT IN ('tenant', 'sucursal') THEN RAISE EXCEPTION 'Alcance inv├ílido: use tenant o sucursal'; END IF;
        IF p_alcance = 'tenant' THEN
          IF NOT EXISTS (SELECT 1 FROM public.caja_tesoreria WHERE tenant_id = p_tenant_id AND sucursal_id IS NULL) THEN
            INSERT INTO public.caja_tesoreria (tenant_id, sucursal_id, nombre, activa)
            VALUES (p_tenant_id, NULL, 'Caja interna central', true);
          ELSE
            UPDATE public.caja_tesoreria SET activa = true, updated_at = now()
            WHERE tenant_id = p_tenant_id AND sucursal_id IS NULL;
          END IF;
          UPDATE public.caja_tesoreria SET activa = false, updated_at = now()
          WHERE tenant_id = p_tenant_id AND sucursal_id IS NOT NULL;
          GET DIAGNOSTICS v_count = ROW_COUNT;
          RETURN jsonb_build_object('alcance', 'tenant', 'desactivadas_sucursales', v_count);
        END IF;
        UPDATE public.caja_tesoreria SET activa = false, updated_at = now()
        WHERE tenant_id = p_tenant_id AND sucursal_id IS NULL;
        FOR v_sucursal IN SELECT id, nombre FROM public.sucursal WHERE tenant_id = p_tenant_id AND activa = true LOOP
          INSERT INTO public.caja_tesoreria (tenant_id, sucursal_id, nombre, activa)
          VALUES (p_tenant_id, v_sucursal.id, 'Caja interna ÔÇö ' || v_sucursal.nombre, true)
          ON CONFLICT (tenant_id, sucursal_id) WHERE sucursal_id IS NOT NULL DO UPDATE
            SET activa = true, nombre = EXCLUDED.nombre, updated_at = now();
          v_count := v_count + 1;
        END LOOP;
        RETURN jsonb_build_object('alcance', 'sucursal', 'sucursales_provisionadas', v_count);
      END; $$;
    `;
  }
}
