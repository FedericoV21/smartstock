-- % de descuento de proveedor elegido en el preview al importar la lista (sobre costo extraído).
-- Los items guardan precio_lista ya neto. Independiente de descuento_proveedor_pct_aplicado al tocar "Aplicar al catálogo".

ALTER TABLE public.lista_precios
  ADD COLUMN descuento_proveedor_pct_carga NUMERIC(5, 2) NULL
    CONSTRAINT chk_lista_precios_descuento_carga
      CHECK (
        descuento_proveedor_pct_carga IS NULL
        OR (
          descuento_proveedor_pct_carga >= 0
          AND descuento_proveedor_pct_carga < 100
        )
      );

COMMENT ON COLUMN public.lista_precios.descuento_proveedor_pct_carga IS
  'Snapshot del descuento % usado al confirmar el preview de importación. Se aplica una sola vez sobre el precio extraído; lista_precios_item.precio_lista queda neto.';
