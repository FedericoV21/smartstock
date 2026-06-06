import type { MpPointPaymentIntent } from '../types/mp-point.types';

export function mpPointIntentIndicaCobroRechazadoExplicito(intent: MpPointPaymentIntent): boolean {
  if (intent.state !== 'FINISHED' || !intent.payment) return false;
  const s = intent.payment.state;
  return s === 'rejected' || s === 'cancelled' || s === 'error';
}
