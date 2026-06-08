/**
 * Comprobantes que deben obtener CAE en ARCA/AFIP para considerarse emitidos correctamente.
 * Alineado con `requiereAutorizacionArca` en emitir-comprobante (ticket / remito / presupuesto no aplican).
 */
export function tipoComprobanteRequiereCaeAfip(tipo: string | null | undefined): boolean {
  const t = String(tipo ?? '');
  return (
    t === 'factura' ||
    t === 'nota_credito' ||
    t.startsWith('factura_') ||
    t.startsWith('nota_credito_')
  );
}
