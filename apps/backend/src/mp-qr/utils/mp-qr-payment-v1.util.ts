import {
  pagoV1AunProcesandose,
  pagoV1FueRechazadoOAnulado,
  pagoV1PermiteEmitirComprobante,
} from '../../mp-point/utils/payment-v1.util';

export { pagoV1AunProcesandose, pagoV1FueRechazadoOAnulado, pagoV1PermiteEmitirComprobante };

const MP_V1 = 'https://api.mercadopago.com/v1';

export type MpQrPaymentV1Detalle = {
  id: number;
  status: string;
  status_detail: string | null;
  external_reference: string | null;
  merchant_order_id: string | null;
  transaction_amount: number | null;
};

function stringOrNull(value: unknown): string | null {
  if (value == null) return null;
  const t = String(value).trim();
  return t ? t : null;
}

export async function fetchMercadoPagoPaymentV1Detalle(
  accessToken: string,
  paymentId: number | string,
  options?: { fetchImpl?: typeof fetch },
): Promise<MpQrPaymentV1Detalle | null> {
  const idNum = Number(paymentId);
  if (!Number.isFinite(idNum) || idNum <= 0) return null;

  const fetchFn = options?.fetchImpl ?? globalThis.fetch;
  const res = await fetchFn(`${MP_V1}/payments/${encodeURIComponent(String(idNum))}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!res.ok) return null;

  try {
    const raw = (await res.json()) as Record<string, unknown>;
    const id = Number(raw.id);
    const status = stringOrNull(raw.status)?.toLowerCase();
    if (!Number.isFinite(id) || !status) return null;

    let merchantOrderId: string | null = null;
    const order = raw.order;
    if (order && typeof order === 'object') {
      merchantOrderId = stringOrNull((order as Record<string, unknown>).id);
    }
    if (!merchantOrderId) {
      merchantOrderId = stringOrNull(raw.merchant_order_id);
    }

    return {
      id,
      status,
      status_detail: raw.status_detail != null && raw.status_detail !== '' ? String(raw.status_detail) : null,
      external_reference: stringOrNull(raw.external_reference),
      merchant_order_id: merchantOrderId,
      transaction_amount:
        raw.transaction_amount != null && Number.isFinite(Number(raw.transaction_amount))
          ? Number(raw.transaction_amount)
          : null,
    };
  } catch {
    return null;
  }
}

export async function buscarMerchantOrderIdPorExternalReference(
  accessToken: string,
  externalReference: string,
  options?: { fetchImpl?: typeof fetch },
): Promise<string | null> {
  const ref = externalReference.trim();
  if (!ref) return null;
  const fetchFn = options?.fetchImpl ?? globalThis.fetch;
  const url = `https://api.mercadopago.com/merchant_orders/search?external_reference=${encodeURIComponent(ref)}`;
  try {
    const res = await fetchFn(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as Record<string, unknown>;
    const elements = raw.elements;
    if (!Array.isArray(elements) || elements.length === 0) return null;
    const first = elements[0];
    if (!first || typeof first !== 'object') return null;
    const id = (first as Record<string, unknown>).id;
    return id != null ? String(id).trim() || null : null;
  } catch {
    return null;
  }
}

export function montoAprobadoSuficiente(
  payments: Array<{ status: string; transaction_amount: number; id: number; payment_type_id?: string; payment_method_id?: string }>,
  totalOrden: number,
  eps = 0.015,
): { ok: boolean; paymentId: number; paymentType?: string } {
  for (const p of payments) {
    if (p.status === 'approved' && p.transaction_amount + eps >= totalOrden - eps) {
      return {
        ok: true,
        paymentId: p.id > 0 ? p.id : 0,
        paymentType: [p.payment_type_id, p.payment_method_id].filter(Boolean).join(' · ') || undefined,
      };
    }
  }
  return { ok: false, paymentId: 0 };
}
