import type {
  MpQrClient,
  MpQrCreateOrderPayload,
  MpQrCreateOrderResponse,
  MpQrMerchantOrder,
} from './types/mp-qr.types';
import { MpQrError } from './errors/mp-qr.error';

export const MP_QR_API_BASE = 'https://api.mercadopago.com';

type MpFetch = typeof fetch;
type MpQrOrderScopeOptions = { externalStoreId?: string | null };
type MpQrCancelOrderOptions = MpQrOrderScopeOptions & { orderId?: string | null };

export function normalizeMpOrdersApiOrderId(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const id = String(value).trim();
  return /^ORD[A-Za-z0-9]{26}$/.test(id) ? id : null;
}

function createIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `mp-qr-cancel-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseMpErrorBody(
  status: number,
  text: string,
): { code: string; message: string; details: Record<string, unknown> | null } {
  const trimmed = text.trim();
  const preview = trimmed.replace(/\s+/g, ' ').slice(0, 240);
  if (!trimmed) {
    return { code: `http_${status}`, message: `HTTP ${status}`, details: null };
  }
  if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) {
    return {
      code: `http_${status}_html`,
      details: { preview },
      message: `Mercado Pago devolvió HTML inesperado (HTTP ${status}). Revisá User ID, token y external_pos_id.`,
    };
  }
  try {
    const j = JSON.parse(trimmed) as Record<string, unknown>;
    const message =
      (typeof j.message === 'string' && j.message) ||
      (typeof j.cause === 'string' && j.cause) ||
      (typeof j.error === 'string' && j.error) ||
      trimmed.slice(0, 2000);
    const code =
      (typeof j.code === 'string' && j.code) ||
      (typeof j.error === 'string' && j.error) ||
      `http_${status}`;
    return { code, message: String(message), details: j };
  } catch {
    return { code: `http_${status}`, message: trimmed.slice(0, 2000), details: { preview } };
  }
}

async function throwIfNotOk(res: Response): Promise<void> {
  if (res.ok) return;
  const text = await res.text();
  const { code, message, details } = parseMpErrorBody(res.status, text);
  throw new MpQrError(message, code, res.status, details);
}

async function jsonOrEmpty<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) return {} as T;
  return JSON.parse(text) as T;
}

function normalizeMerchantOrder(raw: Record<string, unknown>): MpQrMerchantOrder {
  const paysRaw = raw.payments;
  const payments: MpQrMerchantOrder['payments'] = [];
  if (Array.isArray(paysRaw)) {
    for (const p of paysRaw) {
      if (!p || typeof p !== 'object') continue;
      const pr = p as Record<string, unknown>;
      const st = pr.status;
      let status: MpQrMerchantOrder['payments'][0]['status'] = 'pending';
      if (
        st === 'approved' ||
        st === 'pending' ||
        st === 'rejected' ||
        st === 'cancelled' ||
        st === 'refunded'
      ) {
        status = st;
      }
      payments.push({
        id: Number(pr.id ?? 0),
        status,
        status_detail: pr.status_detail != null ? String(pr.status_detail) : '',
        transaction_amount: Number(pr.transaction_amount ?? 0),
        payment_method_id: pr.payment_method_id != null ? String(pr.payment_method_id) : '',
        payment_type_id: pr.payment_type_id != null ? String(pr.payment_type_id) : '',
        ...(typeof pr.date_approved === 'string' ? { date_approved: pr.date_approved } : {}),
      });
    }
  }
  const st = raw.status;
  let status: MpQrMerchantOrder['status'] = 'opened';
  if (st === 'closed' || st === 'expired' || st === 'opened') {
    status = st;
  }
  return {
    id: Number(raw.id ?? 0),
    status,
    external_reference: raw.external_reference != null ? String(raw.external_reference) : '',
    ...(raw.preference_id != null ? { preference_id: String(raw.preference_id) } : {}),
    payments,
    shipments: Array.isArray(raw.shipments) ? raw.shipments : [],
    total_amount: Number(raw.total_amount ?? 0),
    paid_amount: Number(raw.paid_amount ?? 0),
    refunded_amount: Number(raw.refunded_amount ?? 0),
  };
}

export interface GetMpQrClientOptions {
  fetchImpl?: MpFetch;
}

export function createMpQrClient(
  accessToken: string,
  userId: string,
  options?: GetMpQrClientOptions,
): MpQrClient {
  const fetchFn: MpFetch = options?.fetchImpl ?? globalThis.fetch;
  const uid = encodeURIComponent(String(userId).trim());

  function dynamicQrOrderUrl(externalPosId: string): string {
    const pos = encodeURIComponent(externalPosId.trim());
    return `${MP_QR_API_BASE}/instore/orders/qr/seller/collectors/${uid}/pos/${pos}/qrs`;
  }

  function instoreOrderWithStoreUrl(externalStoreId: string, externalPosId: string): string {
    const store = encodeURIComponent(externalStoreId.trim());
    const pos = encodeURIComponent(externalPosId.trim());
    return `${MP_QR_API_BASE}/instore/qr/seller/collectors/${uid}/stores/${store}/pos/${pos}/orders`;
  }

  function instoreOrderUrl(externalPosId: string): string {
    const pos = encodeURIComponent(externalPosId.trim());
    return `${MP_QR_API_BASE}/instore/qr/seller/collectors/${uid}/pos/${pos}/orders`;
  }

  function mpmobileOrderUrl(externalPosId: string): string {
    const pos = encodeURIComponent(externalPosId.trim());
    return `${MP_QR_API_BASE}/mpmobile/instore/qr/${uid}/${pos}`;
  }

  function ordersApiCancelUrl(orderId: string): string {
    return `${MP_QR_API_BASE}/v1/orders/${encodeURIComponent(orderId)}/cancel`;
  }

  const headersAuth = (): HeadersInit => ({
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  });

  const headersJson = (): HeadersInit => ({
    ...headersAuth(),
    'Content-Type': 'application/json',
  });

  async function createOrder(
    externalPosId: string,
    payload: MpQrCreateOrderPayload,
    scope?: MpQrOrderScopeOptions,
  ): Promise<MpQrCreateOrderResponse> {
    const externalStoreId = scope?.externalStoreId?.trim();
    const url = externalStoreId
      ? instoreOrderWithStoreUrl(externalStoreId, externalPosId)
      : dynamicQrOrderUrl(externalPosId);
    const res = await fetchFn(url, {
      method: 'PUT',
      headers: headersJson(),
      body: JSON.stringify(payload),
    });
    await throwIfNotOk(res);
    return jsonOrEmpty<MpQrCreateOrderResponse>(res);
  }

  async function getOrder(
    externalPosId: string,
    _scope?: MpQrOrderScopeOptions,
  ): Promise<MpQrCreateOrderResponse> {
    const res = await fetchFn(instoreOrderUrl(externalPosId), {
      method: 'GET',
      headers: headersAuth(),
    });
    await throwIfNotOk(res);
    return jsonOrEmpty<MpQrCreateOrderResponse>(res);
  }

  async function cancelOrder(
    externalPosId: string,
    scope?: MpQrCancelOrderOptions,
  ): Promise<void> {
    const orderId = normalizeMpOrdersApiOrderId(scope?.orderId);
    if (orderId) {
      await cancelOrdersApiOrder(orderId);
      return;
    }

    const res = await fetchFn(instoreOrderUrl(externalPosId), {
      method: 'DELETE',
      headers: headersJson(),
    });
    if (res.status === 404) return;
    if (res.ok) {
      await tryDeleteMpmobileOrder(externalPosId).catch(() => {});
      return;
    }
    const text = await res.text();
    const { code, message, details } = parseMpErrorBody(res.status, text);
    if (await tryDeleteMpmobileOrder(externalPosId).catch(() => false)) {
      return;
    }
    const friendlyMessage =
      code === 'in_store_order_delete_error' || code === 'instore_order_locked_error'
        ? 'Mercado Pago no pudo cancelar la orden QR. Puede estar cerrada o con un pago en curso.'
        : message;
    throw new MpQrError(friendlyMessage, code, res.status, details);
  }

  async function cancelOrdersApiOrder(orderId: string): Promise<void> {
    const res = await fetchFn(ordersApiCancelUrl(orderId), {
      method: 'POST',
      headers: {
        ...headersJson(),
        'X-Idempotency-Key': createIdempotencyKey(),
      },
    });
    if (res.ok || res.status === 404) return;

    const text = await res.text();
    const { code, message, details } = parseMpErrorBody(res.status, text);
    if (res.status === 409 && code === 'order_already_canceled') return;

    const friendlyMessage =
      code === 'instore_order_locked_error'
        ? 'Mercado Pago no pudo cancelar la orden QR porque el pago ya está en curso.'
        : message;
    throw new MpQrError(friendlyMessage, code, res.status, details);
  }

  async function tryDeleteMpmobileOrder(externalPosId: string): Promise<boolean> {
    const res = await fetchFn(mpmobileOrderUrl(externalPosId), {
      method: 'DELETE',
      headers: headersJson(),
    });
    return res.ok || res.status === 404;
  }

  async function getMerchantOrder(merchantOrderId: number | string): Promise<MpQrMerchantOrder> {
    const id = encodeURIComponent(String(merchantOrderId).trim());
    const url = `${MP_QR_API_BASE}/merchant_orders/${id}`;
    const res = await fetchFn(url, { method: 'GET', headers: headersAuth() });
    await throwIfNotOk(res);
    const raw = (await res.json()) as Record<string, unknown>;
    return normalizeMerchantOrder(raw);
  }

  return { createOrder, getOrder, cancelOrder, getMerchantOrder };
}
