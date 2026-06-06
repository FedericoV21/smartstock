import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-SUC-003: override de precios y PLU por sucursal (paridad Supabase 104 + 189).
 */
export class NbSuc003PrecioPluSucursalSchema1747400000000 implements MigrationInterface {
  name = 'NbSuc003PrecioPluSucursalSchema1747400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS public.precio_sucursal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  producto_id uuid NOT NULL REFERENCES public.producto (id) ON DELETE CASCADE,
  sucursal_id uuid NOT NULL REFERENCES public.sucursal (id) ON DELETE RESTRICT,
  precio_costo numeric(12, 2),
  precio_venta numeric(12, 2),
  porcentaje_ganancia numeric(5, 2),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_precio_sucursal_positivo CHECK (
    (precio_costo IS NULL OR precio_costo >= 0)
    AND (precio_venta IS NULL OR precio_venta >= 0)
  ),
  CONSTRAINT chk_precio_sucursal_ganancia_nonneg CHECK (
    porcentaje_ganancia IS NULL OR porcentaje_ganancia >= 0
  ),
  CONSTRAINT uk_precio_sucursal_producto_sucursal UNIQUE (producto_id, sucursal_id)
);

CREATE INDEX IF NOT EXISTS idx_precio_sucursal_tenant
  ON public.precio_sucursal (tenant_id);

CREATE INDEX IF NOT EXISTS idx_precio_sucursal_tenant_sucursal_producto
  ON public.precio_sucursal (tenant_id, sucursal_id, producto_id);

CREATE TRIGGER precio_sucursal_set_updated_at
  BEFORE UPDATE ON public.precio_sucursal
  FOR EACH ROW
  EXECUTE FUNCTION public.moddatetime();

COMMENT ON TABLE public.precio_sucursal IS
  'Override de precios por sucursal (opcional). Si no hay fila, rigen producto.precio_costo / precio_venta.';

COMMENT ON COLUMN public.precio_sucursal.porcentaje_ganancia IS
  'Ganancia porcentual propia de la sucursal. Si tiene valor, precio_venta es derivado desde costo + ganancia + IVA.';

CREATE TABLE IF NOT EXISTS public.plu_sucursal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  producto_id uuid NOT NULL REFERENCES public.producto (id) ON DELETE CASCADE,
  sucursal_id uuid NOT NULL REFERENCES public.sucursal (id) ON DELETE RESTRICT,
  plu varchar(5) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uk_plu_sucursal_producto_sucursal UNIQUE (producto_id, sucursal_id),
  CONSTRAINT chk_plu_sucursal_formato CHECK (plu ~ '^[0-9]{1,5}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_plu_sucursal_tenant_sucursal_plu
  ON public.plu_sucursal (tenant_id, sucursal_id, plu);

CREATE INDEX IF NOT EXISTS idx_plu_sucursal_tenant
  ON public.plu_sucursal (tenant_id);

CREATE INDEX IF NOT EXISTS idx_plu_sucursal_sucursal
  ON public.plu_sucursal (sucursal_id);

CREATE TRIGGER plu_sucursal_set_updated_at
  BEFORE UPDATE ON public.plu_sucursal
  FOR EACH ROW
  EXECUTE FUNCTION public.moddatetime();

COMMENT ON TABLE public.plu_sucursal IS
  'Override de PLU por sucursal para balanzas. Si no hay fila, el POS usa producto.plu.';
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP TABLE IF EXISTS public.plu_sucursal;
DROP TABLE IF EXISTS public.precio_sucursal;
`);
  }
}
