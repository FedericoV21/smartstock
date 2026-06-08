import { tipoComprobanteRequiereCaeAfip } from '@/lib/mp-point/tipo-requiere-cae';

/**
 * Venta MP QR cerrada en Nexus: pago QR registrado y comprobante en estado válido.
 * Facturas / NC fiscales: también exige **CAE** (no basta `emitido` sin CAE si el tipo fiscal lo requiere).
 */
export function comprobanteEsVentaMpQrCompleta(c: {
  estado: string;
  tipo?: string | null;
  cae?: string | null;
  mp_qr_payment_id?: number | null;
}): boolean {
  if (c.estado !== 'emitido') return false;
  const pid = c.mp_qr_payment_id;
  if (pid == null || !(Number(pid) > 0)) return false;
  if (tipoComprobanteRequiereCaeAfip(c.tipo)) {
    if (!String(c.cae ?? '').trim()) return false;
  }
  return true;
}

/** Pago QR ya asociado al comprobante (puede faltar CAE / emitido). */
export function comprobanteTienePagoMpQr(c: { mp_qr_payment_id?: number | string | null }): boolean {
  const pid = c.mp_qr_payment_id;
  if (pid == null) return false;
  const n = typeof pid === 'number' ? pid : Number(String(pid).trim());
  return Number.isFinite(n) && n > 0;
}
