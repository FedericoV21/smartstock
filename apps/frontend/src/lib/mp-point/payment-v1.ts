/**
 * API REST clásica de pagos de Mercado Pago (no confundir con Point integration-api).
 * La emisión de factura debe basarse en GET /v1/payments/{id} y su `status`, no en el
 * objeto `payment` embebido en el payment intent (a menudo sin estado o desfasado).
 * @see https://www.mercadopago.com.ar/developers/es/reference/payments_api/payment_get
 */

type MpFetch = typeof fetch;

export const MP_V1_API_BASE = 'https://api.mercadopago.com/v1';

export interface MercadoPagoPaymentV1 {
  id: number;
  /** Ej.: approved, rejected, pending, in_process, cancelled, accredited… */
  status: string;
  status_detail: string | null;
}

/**
 * @returns el pago o `null` si falla la red, JSON inválido o HTTP no 2xx.
 */
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
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(
        '[mp-point] GET /v1/payments',
        paymentId,
        res.status,
        text.slice(0, 500),
      );
      return null;
    }
    const raw = (await res.json()) as Record<string, unknown>;
    const id = Number(raw.id);
    const st = raw.status;
    if (!Number.isFinite(id) || typeof st !== 'string' || !st) {
      return null;
    }
    const detail = raw.status_detail;
    return {
      id,
      status: st.toLowerCase().trim(),
      status_detail: detail != null && detail !== '' ? String(detail) : null,
    };
  } catch (e) {
    console.error('[mp-point] fetchMercadoPagoPaymentV1', paymentId, e);
    return null;
  }
}

/** Un solo lugar para decidir si el pago en MP alcanzó el estado con el que se puede emitir factura. */
export function pagoV1PermiteEmitirComprobante(v1: MercadoPagoPaymentV1): boolean {
  return v1.status === 'approved';
}

/**
 * Pago todavía en curso; no se emite ni se revierte el borrador.
 * Incluye variantes de MP según entidad y flujo.
 */
export function pagoV1AunProcesandose(v1: MercadoPagoPaymentV1): boolean {
  const s = v1.status;
  return s === 'pending' || s === 'in_process' || s === 'in_mediation' || s === 'authorized';
}

export function pagoV1FueRechazadoOAnulado(v1: MercadoPagoPaymentV1): boolean {
  const s = v1.status;
  return s === 'rejected' || s === 'cancelled';
}

/**
 * Pago aprobado en el intent o id presente, para disparar lógica que consulta v1
 * (el intent a veces trae el resto de datos incompletos).
 */
export function intentPointFinalizoConPagoId(intent: {
  state: string;
  payment?: { id?: number } | null;
}): boolean {
  if (intent.state !== 'FINISHED' || !intent.payment?.id) return false;
  const n = Number(intent.payment.id);
  return Number.isFinite(n) && n > 0;
}
