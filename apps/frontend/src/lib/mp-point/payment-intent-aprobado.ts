import type { MpPointPaymentIntent } from '@/types/mp-point';

/**
 * Indica si el **intent** de Point trae un rechazo claro (útil con / sin GET v1).
 * La **emisión** del comprobante se decide con `GET /v1/payments/{id}` y `status` (pago aprobado).
 */
export function mpPointIntentIndicaCobroAprobado(intent: MpPointPaymentIntent): boolean {
  if (intent.state !== 'FINISHED' || !intent.payment) return false;
  const id = Number(intent.payment.id);
  if (!id || id <= 0) return false;
  const s = intent.payment.state;
  if (s == null) return false;
  if (s === 'rejected' || s === 'cancelled' || s === 'error') return false;
  if (s === 'approved' || String(s).toLowerCase() === 'approved' || String(s).toLowerCase() === 'accredited') {
    return true;
  }
  return false;
}

export function mpPointIntentIndicaCobroRechazadoExplicito(
  intent: MpPointPaymentIntent,
): boolean {
  if (intent.state !== 'FINISHED' || !intent.payment) return false;
  const s = intent.payment.state;
  return s === 'rejected' || s === 'cancelled' || s === 'error';
}
