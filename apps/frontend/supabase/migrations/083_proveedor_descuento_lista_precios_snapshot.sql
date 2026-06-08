-- V90-PROV-001: descuento por proveedor en listas de precios (analizador).
-- proveedor.descuento_pct: default al procesar listas vinculadas a ese proveedor.
-- lista_precios.descuento_proveedor_pct_aplicado: snapshot al aplicar la lista.

ALTER TABLE public.proveedor
  ADD COLUMN descuento_pct NUMERIC(5, 2) NOT NULL DEFAULT 0
    CONSTRAINT chk_proveedor_descuento_pct
      CHECK (descuento_pct >= 0 AND descuento_pct < 100);

COMMENT ON COLUMN public.proveedor.descuento_pct IS
  'Descuento porcentual estándar acordado con este proveedor. Se aplica automáticamente sobre los costos al procesar una lista de precios vinculada a este proveedor (módulo analizador). NO se aplica en lector-facturas, NO se aplica automáticamente en carga manual de productos.';

ALTER TABLE public.lista_precios
  ADD COLUMN descuento_proveedor_pct_aplicado NUMERIC(5, 2) NULL
    CONSTRAINT chk_lista_precios_descuento_proveedor_pct_aplicado
      CHECK (
        descuento_proveedor_pct_aplicado IS NULL
        OR (
          descuento_proveedor_pct_aplicado >= 0
          AND descuento_proveedor_pct_aplicado < 100
        )
      );

COMMENT ON COLUMN public.lista_precios.descuento_proveedor_pct_aplicado IS
  'Snapshot del descuento de proveedor que se usó al aplicar esta lista. Se setea cuando la lista pasa a estado aplicado/parcialmente_aplicado. Es independiente del proveedor.descuento_pct actual: si el descuento del proveedor cambia después, esta lista mantiene su valor histórico.';
