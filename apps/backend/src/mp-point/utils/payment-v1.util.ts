export const MP_V1_API_BASE = 'https://api.mercadopago.com/v1';

export interface MercadoPagoPaymentV1 {
  id: number;
  status: string;
  statusDetail: string | null;
}

type MpFetch = typeof fetch;

export async function fetchMercadoPagoPaymentV1(
  accessToken: string,
  paymentId: number,
  options?: { fetchImpl?: MpFetch },
): Promise<MercadoPagoPaymentV1 | null> {
  if (!Number.isFinite(paymentId) || paymentId <= 0) return null;
  const fetchFn: MpFetch = options?.fetchImpl ?? globalThis.fetch;
  const url = `${MP_V1_API_BASE}/payments/${encodeURIComponent(String(paymentId))}`;
  try {
    const res = await fetchFn(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as Record<string, unknown>;
    const id = Number(raw.id);
    const st = raw.status;
    if (!Number.isFinite(id) || typeof st !== 'string' || !st) return null;
    const detail = raw.status_detail;
    return {
      id,
      status: st.toLowerCase().trim(),
      statusDetail: detail != null && detail !== '' ? String(detail) : null,
    };
  } catch {
    return null;
  }
}

export function pagoV1PermiteEmitirComprobante(v1: MercadoPagoPaymentV1): boolean {
  return v1.status === 'approved';
}

export function pagoV1AunProcesandose(v1: MercadoPagoPaymentV1): boolean {
  const s = v1.status;
  return s === 'pending' || s === 'in_process' || s === 'in_mediation' || s === 'authorized';
}

export function pagoV1FueRechazadoOAnulado(v1: MercadoPagoPaymentV1): boolean {
  const s = v1.status;
  return s === 'rejected' || s === 'cancelled';
}

export function intentPointFinalizoConPagoId(intent: {
  state: string;
  payment?: { id?: number | string } | null;
}): boolean {
  if (intent.state !== 'FINISHED' || !intent.payment?.id) return false;
  const n = Number(intent.payment.id);
  return Number.isFinite(n) && n > 0;
}
