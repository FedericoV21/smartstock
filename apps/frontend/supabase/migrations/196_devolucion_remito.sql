-- Devolución de remito: reverso operativo de un remito de venta (reingreso de stock, sin ARCA).
ALTER TYPE public.tipo_comprobante ADD VALUE IF NOT EXISTS 'devolucion_remito';

COMMENT ON TYPE public.tipo_comprobante IS
  'Tipos de comprobante de venta/emisión. devolucion_remito: reverso parcial o total de un remito emitido (análogo a nota de crédito sin fiscal).';
