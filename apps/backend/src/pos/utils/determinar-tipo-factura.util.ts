export type CondicionIvaPos =
  | 'responsable_inscripto'
  | 'monotributista'
  | 'exento'
  | 'consumidor_final';

export type TipoFacturaVenta = 'factura_a' | 'factura_b' | 'factura_c';

export function normalizarCondicionIva(value: string | null | undefined): CondicionIvaPos {
  switch (value) {
    case 'responsable_inscripto':
    case 'monotributista':
    case 'exento':
    case 'consumidor_final':
      return value;
    default:
      return 'consumidor_final';
  }
}

export function determinarTipoComprobantePos(
  emisor: CondicionIvaPos,
  receptor: CondicionIvaPos,
  quiereTicket: boolean,
): 'ticket' | TipoFacturaVenta {
  if (quiereTicket) return 'ticket';
  if (emisor === 'monotributista' || emisor === 'exento') return 'factura_c';
  if (receptor === 'responsable_inscripto') return 'factura_a';
  return 'factura_b';
}
