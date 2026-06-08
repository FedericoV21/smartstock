import {
  pagoV1AunProcesandose,
  pagoV1FueRechazadoOAnulado,
  pagoV1PermiteEmitirComprobante,
} from '@/lib/mp-point/payment-v1';

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

/** GET /v1/payments/{id} — usado cuando MP notifica `type=payment` (QR instore). */
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
  if (!res.ok) {
    const text = await res.text();
    console.error('[mp-qr] GET /v1/payments', idNum, res.status, text.slice(0, 500));
    return null;
  }

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

    const detail = raw.status_detail;
    return {
      id,
      status,
      status_detail: detail != null && detail !== '' ? String(detail) : null,
      external_reference: stringOrNull(raw.external_reference),
      merchant_order_id: merchantOrderId,
      transaction_amount:
        raw.transaction_amount != null && Number.isFinite(Number(raw.transaction_amount))
          ? Number(raw.transaction_amount)
          : null,
    };
  } catch (e) {
    console.error('[mp-qr] parse payment v1', idNum, e);
    return null;
  }
}

/** Busca merchant_order asociado al external_reference del cobro QR. */
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
    if (!res.ok) {
      console.warn('[mp-qr] merchant_orders/search', res.status, ref);
      return null;
    }
    const raw = (await res.json()) as Record<string, unknown>;
    const elements = raw.elements;
    if (!Array.isArray(elements) || elements.length === 0) return null;
    const first = elements[0];
    if (!first || typeof first !== 'object') return null;
    const id = (first as Record<string, unknown>).id;
    return id != null ? String(id).trim() || null : null;
  } catch (e) {
    console.error('[mp-qr] merchant_orders/search', ref, e);
    return null;
  }
}
