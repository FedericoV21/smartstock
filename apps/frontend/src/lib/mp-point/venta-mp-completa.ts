import { tipoComprobanteRequiereCaeAfip } from '@/lib/mp-point/tipo-requiere-cae';

/**
 * Venta por Point cerrada en Nexus: pago MP registrado y comprobante en estado final válido.
 * Facturas / NC fiscales: además exigen **CAE** (no basta `emitido` sin CAE).
 * Ticket en negro y demás no fiscales: `emitido` + id de pago alcanza.
 */
export function comprobanteEsVentaMpPointCompleta(c: {
  estado: string;
  tipo?: string | null;
  cae?: string | null;
  mp_point_payment_id?: number | null;
}): boolean {
  if (c.estado !== 'emitido') return false;
  const pid = c.mp_point_payment_id;
  if (pid == null) return false;
  if (!(Number(pid) > 0)) return false;
  if (tipoComprobanteRequiereCaeAfip(c.tipo)) {
    const cae = String(c.cae ?? '').trim();
    if (!cae) return false;
  }
  return true;
}

/** Cobro en terminal ya impactó en el comprobante (id de pago MP), aunque ARCA no haya firmado aún. */
export function comprobanteTienePagoMpPoint(c: { mp_point_payment_id?: number | string | null }): boolean {
  const pid = c.mp_point_payment_id;
  if (pid == null) return false;
  const n = typeof pid === 'number' ? pid : Number(String(pid).trim());
  return Number.isFinite(n) && n > 0;
}
