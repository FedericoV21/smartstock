/** Etiquetas legibles para el desglose de cierre de caja (clave `comprobante.metodo_pago`). */
const POR_CLAVE: Record<string, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  transferencia_mp: 'Transferencia MP',
  posnet_mp: 'Posnet MP (Mercado Pago)',
  debito: 'Débito',
  credito: 'Crédito',
  mixto: 'Mixto',
  cuenta_corriente: 'Cuenta corriente (sin cobro en caja)',
  sin_definir: 'Sin definir',
};

export function etiquetaMetodoPagoCierre(metodo: string | null | undefined): string {
  const raw = (metodo ?? '').trim();
  if (!raw) return POR_CLAVE.sin_definir;
  const k = raw.toLowerCase();
  if (POR_CLAVE[k]) return POR_CLAVE[k];
  return raw;
}
