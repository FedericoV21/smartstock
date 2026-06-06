import type { MpPointDevice, MpPointPaymentIntent, MpPointPaymentState } from '../types/mp-point.types';

export function normalizePointIntentState(raw: unknown): MpPointPaymentIntent['state'] {
  const key = String(raw ?? '')
    .trim()
    .replace(/\s+/g, '_')
    .toUpperCase();
  const map: Record<string, MpPointPaymentIntent['state']> = {
    OPEN: 'OPEN',
    ON_TERMINAL: 'ON_TERMINAL',
    PROCESSING: 'PROCESSING',
    PROCESSED: 'PROCESSING',
    FINISHED: 'FINISHED',
    CONFIRMATION_REQUIRED: 'FINISHED',
    CANCELED: 'CANCELED',
    CANCELLED: 'CANCELED',
    ERROR: 'ERROR',
    ABANDONED: 'CANCELED',
  };
  return map[key] ?? 'ERROR';
}

function pickPaymentIdFromIntentRaw(raw: Record<string, unknown>): number | undefined {
  const paymentRaw = raw.payment;
  if (paymentRaw && typeof paymentRaw === 'object') {
    const id = (paymentRaw as Record<string, unknown>).id;
    if (id != null && id !== '') {
      const n = Number(id);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  const root = raw.payment_id;
  if (root != null && root !== '') {
    const n = Number(root);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

export function normalizeMpPointDevice(raw: Record<string, unknown>): MpPointDevice {
  const mode = raw.operating_mode;
  const operating_mode: 'PDV' | 'STANDALONE' = mode === 'STANDALONE' ? 'STANDALONE' : 'PDV';
  return {
    id: String(raw.id ?? ''),
    operating_mode,
    pos_id: Number(raw.pos_id ?? 0),
    store_id: raw.store_id != null ? String(raw.store_id) : '',
    external_pos_id: raw.external_pos_id != null ? String(raw.external_pos_id) : '',
    name: raw.name != null ? String(raw.name) : undefined,
  };
}

export function normalizeMpPointPaymentIntent(raw: Record<string, unknown>): MpPointPaymentIntent {
  const paymentIdResolved = pickPaymentIdFromIntentRaw(raw);
  const paymentRaw = raw.payment;
  let payment: MpPointPaymentIntent['payment'];
  if (paymentRaw && typeof paymentRaw === 'object') {
    const p = paymentRaw as Record<string, unknown>;
    const st = p.state;
    let payState: MpPointPaymentState | undefined;
    if (st === 'approved' || st === 'rejected' || st === 'cancelled' || st === 'error') {
      payState = st;
    } else if (st != null && st !== '') {
      const s = String(st).toLowerCase();
      if (s === 'approved' || s === 'accredited') {
        payState = 'approved';
      }
    }
    const idFinal = paymentIdResolved != null && paymentIdResolved > 0 ? paymentIdResolved : 0;
    if (idFinal > 0) {
      payment = {
        id: idFinal,
        ...(payState !== undefined && { state: payState }),
        type: p.type != null ? String(p.type) : '',
      };
    }
  } else if (paymentIdResolved != null && paymentIdResolved > 0) {
    payment = {
      id: paymentIdResolved,
      type: '',
    };
  }

  const add = raw.additional_info;
  let additional_info: MpPointPaymentIntent['additional_info'] = {
    external_reference: '',
    print_on_terminal: false,
  };
  if (add && typeof add === 'object') {
    const a = add as Record<string, unknown>;
    additional_info = {
      external_reference: a.external_reference != null ? String(a.external_reference) : '',
      print_on_terminal: Boolean(a.print_on_terminal),
    };
  }

  return {
    id: String(raw.id ?? ''),
    state: normalizePointIntentState(raw.state),
    amount: Number(raw.amount ?? 0),
    payment,
    additional_info,
  };
}
