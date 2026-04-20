export function formatearNumeroComprobante(
  puntoDeVenta: number,
  numero: number,
): string {
  const pv = String(puntoDeVenta).padStart(4, '0');
  const num = String(numero).padStart(8, '0');
  return `${pv}-${num}`;
}

export function formatearTipoComprobante(tipo: string): string {
  const labels: Record<string, string> = {
    factura_a: 'Factura A',
    factura_b: 'Factura B',
    factura_c: 'Factura C',
    nota_credito_a: 'Nota de Crédito A',
    nota_credito_b: 'Nota de Crédito B',
    nota_credito_c: 'Nota de Crédito C',
    remito: 'Remito',
    presupuesto: 'Presupuesto',
    ticket: 'Ticket',
  };
  return labels[tipo] ?? tipo;
}

/** Código de comprobante AFIP (RG 4290 / tabla estándar). Para impresión en el PDF. */
export function codigoAfipComprobante(tipo: string): string | null {
  const map: Record<string, string> = {
    factura_a: '001',
    factura_b: '006',
    factura_c: '011',
    nota_credito_a: '003',
    nota_credito_b: '008',
    nota_credito_c: '013',
  };
  return map[tipo] ?? null;
}

export function formatearPuntoVentaAfip(puntoDeVenta: number): string {
  return String(puntoDeVenta).padStart(5, '0');
}

export function formatearNumeroComprobanteAfip(numero: number): string {
  return String(numero).padStart(8, '0');
}
