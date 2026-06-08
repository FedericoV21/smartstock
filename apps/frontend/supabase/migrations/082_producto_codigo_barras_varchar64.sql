-- Ampliar código de barras para SKUs alfanuméricos (Code 128 en etiquetas), no solo EAN/ITF numérico.

ALTER TABLE producto
  ALTER COLUMN codigo_barras TYPE VARCHAR(64);
