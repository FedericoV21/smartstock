import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-LOT-001: lotes de ingreso por producto + trigger de vencimiento pr├│ximo.
 */
export class NbLot001ProductoLoteIngresoSchema1748000000000 implements MigrationInterface {
  name = 'NbLot001ProductoLoteIngresoSchema1748000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS public.producto_lote_ingreso (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  producto_id uuid NOT NULL REFERENCES public.producto (id) ON DELETE CASCADE,
  sucursal_id uuid NOT NULL REFERENCES public.sucursal (id) ON DELETE RESTRICT,
  proveedor_id uuid NULL REFERENCES public.proveedor (id) ON DELETE SET NULL,
  producto_variante_id uuid NULL REFERENCES public.producto_variante (id) ON DELETE SET NULL,
  producto_variante_etiqueta text NULL,
  cantidad numeric(12, 3) NOT NULL,
  fecha_vencimiento date NULL,
  precio_costo numeric(18, 6) NULL,
  origen text NOT NULL,
  importacion_log_id uuid NULL REFERENCES public.importacion_log (id) ON DELETE SET NULL,
  lector_factura_log_id uuid NULL,
  movimiento_id uuid NULL REFERENCES public.movimiento (id) ON DELETE SET NULL,
  creado_por uuid NULL REFERENCES public.usuario (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_producto_lote_origen CHECK (
    origen IN ('importacion', 'lector_facturas', 'manual', 'pos', 'comprobante_compra')
  )
);

CREATE INDEX IF NOT EXISTS idx_producto_lote_tenant_producto
  ON public.producto_lote_ingreso (tenant_id, producto_id);

CREATE INDEX IF NOT EXISTS idx_producto_lote_tenant_producto_vencimiento
  ON public.producto_lote_ingreso (tenant_id, producto_id, fecha_vencimiento)
  WHERE fecha_vencimiento IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_producto_lote_tenant_proveedor
  ON public.producto_lote_ingreso (tenant_id, proveedor_id)
  WHERE proveedor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_producto_lote_movimiento
  ON public.producto_lote_ingreso (movimiento_id)
  WHERE movimiento_id IS NOT NULL;

COMMENT ON TABLE public.producto_lote_ingreso IS
  'Lotes de ingreso: cantidad, vencimiento y costo por partida/proveedor.';

DROP TRIGGER IF EXISTS set_producto_lote_ingreso_updated_at ON public.producto_lote_ingreso;
CREATE TRIGGER set_producto_lote_ingreso_updated_at
  BEFORE UPDATE ON public.producto_lote_ingreso
  FOR EACH ROW
  EXECUTE FUNCTION public.moddatetime();

CREATE OR REPLACE FUNCTION public.fecha_vencimiento_proxima_lote(p_producto_id uuid)
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT MIN(fecha_vencimiento)
  FROM public.producto_lote_ingreso
  WHERE producto_id = p_producto_id
    AND cantidad > 0
    AND fecha_vencimiento IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.trg_producto_lote_refresh_vencimiento()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_producto_id uuid;
  v_proxima date;
  v_existe boolean;
BEGIN
  v_producto_id := COALESCE(NEW.producto_id, OLD.producto_id);
  IF v_producto_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.producto_lote_ingreso
    WHERE producto_id = v_producto_id
      AND cantidad > 0
      AND fecha_vencimiento IS NOT NULL
  ) INTO v_existe;

  IF v_existe THEN
    SELECT MIN(fecha_vencimiento) INTO v_proxima
    FROM public.producto_lote_ingreso
    WHERE producto_id = v_producto_id
      AND cantidad > 0
      AND fecha_vencimiento IS NOT NULL;

    UPDATE public.producto
    SET fecha_vencimiento = v_proxima
    WHERE id = v_producto_id
      AND fecha_vencimiento IS DISTINCT FROM v_proxima;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_producto_lote_refresh_vencimiento_aiu ON public.producto_lote_ingreso;
CREATE TRIGGER trg_producto_lote_refresh_vencimiento_aiu
  AFTER INSERT OR UPDATE OR DELETE ON public.producto_lote_ingreso
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_producto_lote_refresh_vencimiento();
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP TRIGGER IF EXISTS trg_producto_lote_refresh_vencimiento_aiu ON public.producto_lote_ingreso;
DROP FUNCTION IF EXISTS public.trg_producto_lote_refresh_vencimiento();
DROP FUNCTION IF EXISTS public.fecha_vencimiento_proxima_lote(uuid);
DROP TABLE IF EXISTS public.producto_lote_ingreso;
`);
  }
}
