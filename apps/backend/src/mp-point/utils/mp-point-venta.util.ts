import { tipoComprobanteRequiereCaeAfip } from '../../facturacion/utils/comprobante-void.rules';

export function comprobanteEsVentaMpPointCompleta(c: {
  estado: string;
  tipo?: string | null;
  cae?: string | null;
  mpPointPaymentId?: string | number | null;
  mp_point_payment_id?: number | string | null;
}): boolean {
  if (c.estado !== 'emitido') return false;
  const pid = c.mpPointPaymentId ?? c.mp_point_payment_id;
  if (pid == null) return false;
  if (!(Number(pid) > 0)) return false;
  if (tipoComprobanteRequiereCaeAfip(c.tipo)) {
    const cae = String(c.cae ?? '').trim();
    if (!cae) return false;
  }
  return true;
}

export function comprobanteTienePagoMpPoint(c: {
  mpPointPaymentId?: string | number | null;
  mp_point_payment_id?: number | string | null;
}): boolean {
  const pid = c.mpPointPaymentId ?? c.mp_point_payment_id;
  if (pid == null) return false;
  const n = typeof pid === 'number' ? pid : Number(String(pid).trim());
  return Number.isFinite(n) && n > 0;
}
