import { tipoComprobanteRequiereCaeAfip } from '../../facturacion/utils/comprobante-void.rules';
import { EstadoComprobante } from '../../facturacion/enums/estado-comprobante.enum';
import type { Comprobante } from '../../facturacion/entities/comprobante.entity';

export function comprobanteEsVentaMpQrCompleta(c: {
  estado: EstadoComprobante | string;
  tipo?: string | null;
  cae?: string | null;
  mpQrPaymentId?: string | null;
}): boolean {
  if (c.estado !== EstadoComprobante.emitido) return false;
  const pid = c.mpQrPaymentId;
  if (pid == null || !(Number(pid) > 0)) return false;
  if (tipoComprobanteRequiereCaeAfip(c.tipo)) {
    if (!String(c.cae ?? '').trim()) return false;
  }
  return true;
}

export function comprobanteTienePagoMpQr(c: { mpQrPaymentId?: string | null }): boolean {
  const pid = c.mpQrPaymentId;
  if (pid == null) return false;
  const n = Number(String(pid).trim());
  return Number.isFinite(n) && n > 0;
}

export function comprobanteEsVentaMpQrCompletaEntity(comp: Comprobante): boolean {
  return comprobanteEsVentaMpQrCompleta({
    estado: comp.estado,
    tipo: comp.tipo,
    cae: comp.cae,
    mpQrPaymentId: comp.mpQrPaymentId,
  });
}

export function comprobanteTienePagoMpQrEntity(comp: Comprobante): boolean {
  return comprobanteTienePagoMpQr({ mpQrPaymentId: comp.mpQrPaymentId });
}

function redondearPesos(n: number): number {
  return Math.round(n * 100) / 100;
}

export { redondearPesos };
