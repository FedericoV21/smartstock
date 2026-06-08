export const MP_TRANSFERENCIA_REPORT_API_BASE = 'https://api.mercadopago.com/v1/account/settlement_report';
export const MP_PAYMENTS_SEARCH_API_URL = 'https://api.mercadopago.com/v1/payments/search';

type MpFetch = typeof fetch;
type FetchArgs = Parameters<MpFetch>;

export class MpTransferenciaClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details: unknown = null,
  ) {
    super(message);
    this.name = 'MpTransferenciaClientError';
  }
}

export type MpSettlementReportListItem = {
  id?: string | number | null;
  user_id?: string | number | null;
  begin_date?: string | null;
  end_date?: string | null;
  file_name?: string | null;
  date_created?: string | null;
  created_from?: string | null;
};

export type MpPaymentSearchItem = {
  id?: string | number | null;
  date_created?: string | null;
  date_approved?: string | null;
  status?: string | null;
  status_detail?: string | null;
  transaction_amount?: number | string | null;
  currency_id?: string | null;
  payment_method_id?: string | null;
  payment_type_id?: string | null;
  description?: string | null;
  payer?: {
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
    identification?: {
      type?: string | null;
      number?: string | null;
    } | null;
  } | null;
  [key: string]: unknown;
};

export type MpPaymentsSearchResponse = {
  paging?: {
    total?: number | null;
    limit?: number | null;
    offset?: number | null;
  } | null;
  results?: MpPaymentSearchItem[] | null;
};

type MpTransferenciaReportConfigPayload = {
  file_name_prefix: string;
  columns: { key: string }[];
  frequency: { type: 'daily' | 'weekly' | 'monthly'; value: number; hour: number };
  separator?: string;
  display_timezone?: string;
  report_translation?: string;
  header_language?: string;
  scheduled?: boolean;
  include_withdraw?: boolean;
  refund_detailed?: boolean;
  shipping_detail?: boolean;
  coupon_detailed?: boolean;
  show_chargeback_cancel?: boolean;
  show_fee_prevision?: boolean;
};

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function errorMessage(status: number, body: unknown): string {
  if (body && typeof body === 'object') {
    const o = body as Record<string, unknown>;
    const msg = o.message ?? o.error ?? o.cause;
    if (typeof msg === 'string' && msg.trim()) return msg.trim();
  }
  if (typeof body === 'string' && body.trim()) return body.trim().slice(0, 500);
  return `Mercado Pago respondio HTTP ${status}`;
}

function networkErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg && msg !== 'undefined'
    ? `No se pudo conectar con Mercado Pago: ${msg}`
    : 'No se pudo conectar con Mercado Pago';
}

export function getMpTransferenciaClient(accessToken: string, options?: { fetchImpl?: MpFetch }) {
  const fetchFn = options?.fetchImpl ?? globalThis.fetch;
  const headersJson = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  async function mpFetch(...args: FetchArgs): Promise<Response> {
    try {
      return await fetchFn(...args);
    } catch (e) {
      throw new MpTransferenciaClientError(networkErrorMessage(e), 503, {
        cause: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function requestReport(params: { beginDateIso: string; endDateIso: string }): Promise<unknown> {
    const res = await mpFetch(MP_TRANSFERENCIA_REPORT_API_BASE, {
      method: 'POST',
      headers: headersJson,
      body: JSON.stringify({
        begin_date: params.beginDateIso,
        end_date: params.endDateIso,
      }),
    });
    const body = await readBody(res);
    if (res.status === 202 || res.ok) return body;
    throw new MpTransferenciaClientError(errorMessage(res.status, body), res.status, body);
  }

  async function listReports(): Promise<MpSettlementReportListItem[]> {
    const res = await mpFetch(`${MP_TRANSFERENCIA_REPORT_API_BASE}/list`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });
    const body = await readBody(res);
    if (!res.ok) {
      throw new MpTransferenciaClientError(errorMessage(res.status, body), res.status, body);
    }
    return Array.isArray(body) ? (body as MpSettlementReportListItem[]) : [];
  }

  async function getConfig(): Promise<unknown> {
    const res = await mpFetch(`${MP_TRANSFERENCIA_REPORT_API_BASE}/config`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });
    const body = await readBody(res);
    if (!res.ok) {
      throw new MpTransferenciaClientError(errorMessage(res.status, body), res.status, body);
    }
    return body;
  }

  async function createConfig(payload: MpTransferenciaReportConfigPayload): Promise<unknown> {
    const res = await mpFetch(`${MP_TRANSFERENCIA_REPORT_API_BASE}/config`, {
      method: 'POST',
      headers: headersJson,
      body: JSON.stringify(payload),
    });
    const body = await readBody(res);
    if (!res.ok) {
      throw new MpTransferenciaClientError(errorMessage(res.status, body), res.status, body);
    }
    return body;
  }

  async function updateConfig(payload: MpTransferenciaReportConfigPayload): Promise<unknown> {
    const res = await mpFetch(`${MP_TRANSFERENCIA_REPORT_API_BASE}/config`, {
      method: 'PUT',
      headers: headersJson,
      body: JSON.stringify(payload),
    });
    const body = await readBody(res);
    if (!res.ok) {
      throw new MpTransferenciaClientError(errorMessage(res.status, body), res.status, body);
    }
    return body;
  }

  async function downloadReport(fileName: string): Promise<string> {
    const clean = fileName.trim();
    if (!clean) throw new MpTransferenciaClientError('file_name requerido', 400);
    const res = await mpFetch(`${MP_TRANSFERENCIA_REPORT_API_BASE}/${encodeURIComponent(clean)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'text/csv, text/plain, application/octet-stream',
      },
    });
    const text = await res.text();
    if (!res.ok) {
      throw new MpTransferenciaClientError(errorMessage(res.status, text), res.status, text);
    }
    return text;
  }

  async function searchPayments(params: {
    status?: string;
    limit?: number;
    offset?: number;
    sort?: 'date_created' | 'date_approved';
    criteria?: 'asc' | 'desc';
    beginDateIso?: string;
    endDateIso?: string;
  }): Promise<MpPaymentsSearchResponse> {
    const url = new URL(MP_PAYMENTS_SEARCH_API_URL);
    if (params.status) url.searchParams.set('status', params.status);
    url.searchParams.set('limit', String(params.limit ?? 50));
    url.searchParams.set('offset', String(params.offset ?? 0));
    url.searchParams.set('sort', params.sort ?? 'date_created');
    url.searchParams.set('criteria', params.criteria ?? 'desc');
    if (params.beginDateIso) url.searchParams.set('begin_date', params.beginDateIso);
    if (params.endDateIso) url.searchParams.set('end_date', params.endDateIso);

    const res = await mpFetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });
    const body = await readBody(res);
    if (!res.ok) {
      throw new MpTransferenciaClientError(errorMessage(res.status, body), res.status, body);
    }
    return body && typeof body === 'object' ? (body as MpPaymentsSearchResponse) : {};
  }

  return {
    requestReport,
    listReports,
    downloadReport,
    getConfig,
    createConfig,
    updateConfig,
    searchPayments,
  };
}
