import { MigrationInterface, QueryRunner } from 'typeorm';

export class NbLst001ListaPreciosSchema1749200000000 implements MigrationInterface {
  name = 'NbLst001ListaPreciosSchema1749200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE public.estado_lista_precios AS ENUM (
        'pendiente',
        'analizada',
        'aplicada',
        'descartada'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE public.lista_precios (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
        sucursal_id uuid REFERENCES public.sucursal(id) ON DELETE SET NULL,
        proveedor_id uuid NOT NULL REFERENCES public.proveedor(id) ON DELETE RESTRICT,
        nombre text NOT NULL,
        estado public.estado_lista_precios NOT NULL DEFAULT 'pendiente',
        descuento_proveedor_pct_carga numeric(8, 4) NOT NULL DEFAULT 0,
        archivo_url text,
        total_items integer NOT NULL DEFAULT 0,
        items_matcheados integer NOT NULL DEFAULT 0,
        variacion_promedio_pct numeric(12, 4),
        aplicada_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_lista_precios_tenant_estado
        ON public.lista_precios (tenant_id, estado)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_lista_precios_tenant_proveedor
        ON public.lista_precios (tenant_id, proveedor_id)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_lista_precios_tenant_sucursal
        ON public.lista_precios (tenant_id, sucursal_id)
        WHERE sucursal_id IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE public.lista_precios_item (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
        lista_id uuid NOT NULL REFERENCES public.lista_precios(id) ON DELETE CASCADE,
        codigo_proveedor text,
        nombre_proveedor text NOT NULL,
        precio_lista numeric(18, 6) NOT NULL,
        precio_neto numeric(18, 6),
        producto_id uuid REFERENCES public.producto(id) ON DELETE SET NULL,
        precio_costo_actual numeric(18, 6),
        variacion_pct numeric(12, 4),
        margen_actual_pct numeric(12, 4),
        margen_nuevo_pct numeric(12, 4),
        precio_venta_sugerido numeric(18, 6),
        seleccionado boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_lista_precios_item_lista
        ON public.lista_precios_item (lista_id)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_lista_precios_item_producto
        ON public.lista_precios_item (producto_id)
        WHERE producto_id IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS public.lista_precios_item CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS public.lista_precios CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS public.estado_lista_precios CASCADE`);
  }
}
