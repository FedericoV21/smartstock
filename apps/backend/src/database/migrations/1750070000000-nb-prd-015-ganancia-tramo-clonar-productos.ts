import { MigrationInterface, QueryRunner } from 'typeorm';

export class NbPrd015GananciaTramoClonarProductos1750070000000 implements MigrationInterface {
  name = 'NbPrd015GananciaTramoClonarProductos1750070000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS public.producto_ganancia_tramo (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id      UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
        producto_id    UUID NOT NULL REFERENCES public.producto (id) ON DELETE CASCADE,
        cantidad_desde NUMERIC(12, 3) NOT NULL,
        ganancia_pct   NUMERIC(6, 2) NOT NULL,
        orden          INTEGER NOT NULL DEFAULT 0,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT chk_producto_ganancia_tramo_cantidad_desde_pos CHECK (cantidad_desde >= 1),
        CONSTRAINT chk_producto_ganancia_tramo_ganancia_pct_nonneg CHECK (ganancia_pct >= 0)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_producto_ganancia_tramo_unique
        ON public.producto_ganancia_tramo (tenant_id, producto_id, cantidad_desde);

      CREATE INDEX IF NOT EXISTS idx_producto_ganancia_tramo_tenant_producto
        ON public.producto_ganancia_tramo (tenant_id, producto_id, cantidad_desde DESC);

      CREATE INDEX IF NOT EXISTS idx_producto_ganancia_tramo_tenant_producto_orden
        ON public.producto_ganancia_tramo (tenant_id, producto_id, orden);

      DROP TRIGGER IF EXISTS set_producto_ganancia_tramo_updated_at ON public.producto_ganancia_tramo;
      CREATE TRIGGER set_producto_ganancia_tramo_updated_at
        BEFORE UPDATE ON public.producto_ganancia_tramo
        FOR EACH ROW
        EXECUTE FUNCTION public.moddatetime('updated_at');
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.clonar_productos_a_sucursal(
        p_tenant_id            UUID,
        p_sucursal_origen_id   UUID,
        p_sucursal_destino_id  UUID,
        p_producto_ids         UUID[]
      ) RETURNS jsonb
      LANGUAGE plpgsql
      SET search_path = public
      AS $$
      DECLARE
        v_pid      UUID;
        v_o        producto%ROWTYPE;
        v_cat      UUID;
        v_prov     UUID;
        v_new_id   UUID;
        v_creados  UUID[] := ARRAY[]::UUID[];
        v_omitido_items jsonb[] := ARRAY[]::jsonb[];
        v_err      TEXT;
      BEGIN
        IF p_sucursal_origen_id = p_sucursal_destino_id THEN
          RAISE EXCEPTION 'Origen y destino deben ser distintas sucursales';
        END IF;

        IF p_producto_ids IS NULL OR coalesce(array_length(p_producto_ids, 1), 0) = 0 THEN
          RAISE EXCEPTION 'Indicá al menos un producto a clonar';
        END IF;

        FOREACH v_pid IN ARRAY p_producto_ids
        LOOP
          SELECT * INTO v_o
          FROM public.producto
          WHERE id = v_pid
            AND tenant_id = p_tenant_id
            AND sucursal_id = p_sucursal_origen_id;

          IF NOT FOUND THEN
            v_omitido_items := array_append(
              v_omitido_items,
              jsonb_build_object('producto_id', v_pid, 'motivo', 'no encontrado o no pertenece a la sucursal de origen')
            );
            CONTINUE;
          END IF;

          IF NOT v_o.activo THEN
            v_omitido_items := array_append(
              v_omitido_items,
              jsonb_build_object('producto_id', v_pid, 'motivo', 'producto inactivo en origen')
            );
            CONTINUE;
          END IF;

          IF EXISTS (
            SELECT 1 FROM public.producto
            WHERE tenant_id = p_tenant_id
              AND sucursal_id = p_sucursal_destino_id
              AND activo = true
              AND lower(btrim(codigo)) = lower(btrim(v_o.codigo))
              AND unidad = v_o.unidad
          ) THEN
            v_omitido_items := array_append(
              v_omitido_items,
              jsonb_build_object('producto_id', v_pid, 'motivo', 'ya existe en destino (mismo código y unidad)')
            );
            CONTINUE;
          END IF;

          IF EXISTS (
            SELECT 1 FROM public.producto
            WHERE tenant_id = p_tenant_id
              AND sucursal_id = p_sucursal_destino_id
              AND activo = false
              AND lower(btrim(codigo)) = lower(btrim(v_o.codigo))
              AND unidad = v_o.unidad
          ) THEN
            v_omitido_items := array_append(
              v_omitido_items,
              jsonb_build_object('producto_id', v_pid, 'motivo', 'existe producto inactivo en destino; reactivá o unificá')
            );
            CONTINUE;
          END IF;

          v_cat := NULL;
          IF v_o.categoria_id IS NOT NULL THEN
            SELECT c_dest.id INTO v_cat
            FROM public.categoria c_o
            INNER JOIN public.categoria c_dest
              ON c_dest.tenant_id = c_o.tenant_id
              AND c_dest.sucursal_id = p_sucursal_destino_id
              AND c_dest.activa = true
              AND lower(c_dest.nombre) = lower(c_o.nombre)
            WHERE c_o.id = v_o.categoria_id
            LIMIT 1;
          END IF;

          v_prov := v_o.proveedor_id;

          BEGIN
            INSERT INTO public.producto (
              tenant_id, sucursal_id, codigo, nombre, descripcion,
              categoria_id, proveedor_id, unidad,
              precio_costo, precio_venta, stock_actual, stock_minimo,
              moneda, codigo_barras, es_pesable, plu,
              iva_porcentaje, porcentaje_ganancia, rubro, subrubro, ubicacion,
              activo, imagen_url, fecha_vencimiento
            ) VALUES (
              p_tenant_id,
              p_sucursal_destino_id,
              v_o.codigo,
              v_o.nombre,
              v_o.descripcion,
              v_cat,
              v_prov,
              v_o.unidad,
              v_o.precio_costo,
              v_o.precio_venta,
              0,
              v_o.stock_minimo,
              v_o.moneda,
              v_o.codigo_barras,
              v_o.es_pesable,
              NULL,
              v_o.iva_porcentaje,
              v_o.porcentaje_ganancia,
              v_o.rubro,
              v_o.subrubro,
              v_o.ubicacion,
              true,
              NULL,
              NULL
            ) RETURNING id INTO v_new_id;

            v_creados := array_append(v_creados, v_new_id);
          EXCEPTION
            WHEN OTHERS THEN
              GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
              v_omitido_items := array_append(
                v_omitido_items,
                jsonb_build_object('producto_id', v_pid, 'motivo', v_err)
              );
          END;
        END LOOP;

        RETURN jsonb_build_object(
          'creados', to_jsonb(v_creados),
          'total_creados', coalesce(array_length(v_creados, 1), 0),
          'omitidos', coalesce(
            (SELECT jsonb_agg(t) FROM unnest(v_omitido_items) AS t),
            '[]'::jsonb
          )
        );
      END;
      $$;

      ALTER FUNCTION public.clonar_productos_a_sucursal(uuid, uuid, uuid, uuid[])
        SET statement_timeout = '120s';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP FUNCTION IF EXISTS public.clonar_productos_a_sucursal(uuid, uuid, uuid, uuid[]);
      DROP TABLE IF EXISTS public.producto_ganancia_tramo;
    `);
  }
}
