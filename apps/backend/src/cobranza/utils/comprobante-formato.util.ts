export function formatearNumeroComprobante(
  puntoDeVenta: number,
  numero: number | null | undefined,
): string {
  if (numero == null || Number.isNaN(Number(numero))) {
    return 'ÔÇö';
  }
  const pv = String(puntoDeVenta).padStart(4, '0');
  const num = String(numero).padStart(8, '0');
  return `${pv}-${num}`;
}

export function formatearTipoComprobante(tipo: string): string {
  const labels: Record<string, string> = {
    factura_a: 'Factura A',
    factura_b: 'Factura B',
    factura_c: 'Factura C',
    nota_credito_a: 'Nota de Cr├®dito A',
    nota_credito_b: 'Nota de Cr├®dito B',
    nota_credito_c: 'Nota de Cr├®dito C',
    remito: 'Remito',
    devolucion_remito: 'Devoluci├│n de remito',
    presupuesto: 'Presupuesto',
    ticket: 'Ticket',
    recibo: 'Recibo',
  };
  return labels[tipo] ?? tipo.replace(/_/g, ' ');
}
