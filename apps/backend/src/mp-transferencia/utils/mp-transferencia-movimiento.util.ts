import type { MpPaymentSearchItem } from '../mp-transferencia-api.client';
import { parseFechaMp, parseMontoMp } from './mp-transferencia-parse.util';

export type MpTransferenciaMovimientoPublico = {
  id: string;
  mp_movimiento_id: string;
  fecha_operacion: string;
  fecha_hora: string | null;
  monto: number;
  moneda: string;
  transaction_type: string | null;
  payment_type: string | null;
  descripcion: string | null;
  contraparte: string | null;
};

export type MpTransferenciaVerificacionEstado =
  | { estado: 'sin_coincidencias'; movimientos: MpTransferenciaMovimientoPublico[] }
  | { estado: 'una_coincidencia'; movimientos: MpTransferenciaMovimientoPublico[] }
  | { estado: 'multiples'; movimientos: MpTransferenciaMovimientoPublico[] };

export function movimientoPublico(row: {
  id: string;
  mpMovimientoId: string;
  fechaOperacion: string;
  fechaHora: Date | null;
  monto: string;
  moneda: string;
  transactionType: string | null;
  paymentType: string | null;
  descripcion: string | null;
  contraparte: string | null;
}): MpTransferenciaMovimientoPublico {
  return {
    id: row.id,
    mp_movimiento_id: row.mpMovimientoId,
    fecha_operacion: row.fechaOperacion,
    fecha_hora: row.fechaHora?.toISOString() ?? null,
    monto: Number(row.monto),
    moneda: row.moneda ?? 'ARS',
    transaction_type: row.transactionType,
    payment_type: row.paymentType,
    descripcion: row.descripcion,
    contraparte: row.contraparte,
  };
}

function textoContrapartePago(pago: MpPaymentSearchItem): string | null {
  const payer = pago.payer;
  if (!payer) return null;
  const nombre = [payer.first_name, payer.last_name]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(' ');
  if (nombre) return nombre;
  return typeof payer.email === 'string' && payer.email.trim() ? payer.email.trim() : null;
}

export function pagoToMovimiento(
  pago: MpPaymentSearchItem,
): (Omit<MpTransferenciaMovimientoPublico, 'id'> & { raw: Record<string, unknown> }) | null {
  const id = pago.id != null ? String(pago.id).trim() : '';
  if (!id) return null;
  if (String(pago.status ?? '').toLowerCase() !== 'approved') return null;

  const monto = parseMontoMp(pago.transaction_amount);
  if (monto == null || monto <= 0) return null;

  const fecha = parseFechaMp(pago.date_approved ?? pago.date_created);
  if (!fecha) return null;

  return {
    mp_movimiento_id: id,
    fecha_operacion: fecha.ymd,
    fecha_hora: fecha.iso,
    monto,
    moneda:
      typeof pago.currency_id === 'string' && pago.currency_id.trim() ? pago.currency_id.trim() : 'ARS',
    transaction_type: String(pago.status_detail ?? pago.status ?? 'payment'),
    payment_type: String(pago.payment_type_id ?? pago.payment_method_id ?? 'payment'),
    descripcion:
      typeof pago.description === 'string' && pago.description.trim() ? pago.description.trim() : null,
    contraparte: textoContrapartePago(pago),
    raw: { source: 'payments_search', payment: pago },
  };
}
