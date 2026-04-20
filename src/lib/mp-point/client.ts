import type {
  CreateIntentPayload,
  MpPointDevice,
  MpPointPaymentIntent,
  MpPointPaymentState,
} from '@/types/mp-point';

/** Base oficial API Point (sin barra final). */
export const MP_POINT_API_BASE = 'https://api.mercadopago.com/point/integration-api';

export class MpPointError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly bodySnippet?: string,
  ) {
    super(message);
    this.name = 'MpPointError';
  }
}

type MpFetch = typeof fetch;

function parseMpErrorBody(status: number, text: string): { code: string; message: string } {
  const trimmed = text.trim();
  if (!trimmed) {
    return { code: `http_${status}`, message: `HTTP ${status}` };
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
    return { code, message: String(message) };
  } catch {
    return { code: `http_${status}`, message: trimmed.slice(0, 2000) };
  }
}

function logMpFailure(status: number, code: string, message: string): void {
  console.error('[mp-point]', status, code, message);
}

async function throwIfNotOk(res: Response): Promise<void> {
  if (res.ok) return;
  const text = await res.text();
  const { code, message } = parseMpErrorBody(res.status, text);
  logMpFailure(res.status, code, message);
  throw new MpPointError(res.status, code, message, text.slice(0, 2000));
}

function normalizeDevice(raw: Record<string, unknown>): MpPointDevice {
  const mode = raw.operating_mode;
  const operating_mode: 'PDV' | 'STANDALONE' =
    mode === 'STANDALONE' ? 'STANDALONE' : 'PDV';
  return {
    id: String(raw.id ?? ''),
    operating_mode,
    pos_id: Number(raw.pos_id ?? 0),
    store_id: raw.store_id != null ? String(raw.store_id) : '',
    external_pos_id: raw.external_pos_id != null ? String(raw.external_pos_id) : '',
    name: raw.name != null ? String(raw.name) : undefined,
  };
}

function normalizePaymentIntent(raw: Record<string, unknown>): MpPointPaymentIntent {
  const paymentRaw = raw.payment;
  let payment: MpPointPaymentIntent['payment'];
  if (paymentRaw && typeof paymentRaw === 'object') {
    const p = paymentRaw as Record<string, unknown>;
    const st = p.state;
    const state: MpPointPaymentState =
      st === 'approved' ||
      st === 'rejected' ||
      st === 'cancelled' ||
      st === 'error'
        ? st
        : 'error';
    payment = {
      id: Number(p.id ?? 0),
      state,
      type: p.type != null ? String(p.type) : '',
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
      external_reference:
        a.external_reference != null ? String(a.external_reference) : '',
      print_on_terminal: Boolean(a.print_on_terminal),
    };
  }
  const st = raw.state;
  const state: MpPointPaymentIntent['state'] =
    st === 'OPEN' ||
    st === 'ON_TERMINAL' ||
    st === 'PROCESSING' ||
    st === 'FINISHED' ||
    st === 'CANCELED' ||
    st === 'ERROR'
      ? st
      : 'ERROR';
  return {
    id: String(raw.id ?? ''),
    state,
    amount: Number(raw.amount ?? 0),
    payment,
    additional_info,
  };
}

export interface MpPointClient {
  listDevices(): Promise<MpPointDevice[]>;
  setDeviceMode(deviceId: string, mode: 'PDV' | 'STANDALONE'): Promise<void>;
  createPaymentIntent(
    deviceId: string,
    payload: CreateIntentPayload,
  ): Promise<MpPointPaymentIntent>;
  getPaymentIntent(deviceId: string, intentId: string): Promise<MpPointPaymentIntent>;
  cancelPaymentIntent(deviceId: string, intentId: string): Promise<void>;
}

export interface GetMpPointClientOptions {
  /** Inyectable para tests (mocks). Por defecto `globalThis.fetch`. */
  fetchImpl?: MpFetch;
}

export function getMpPointClient(
  accessToken: string,
  options?: GetMpPointClientOptions,
): MpPointClient {
  const fetchFn: MpFetch = options?.fetchImpl ?? globalThis.fetch;

  const headersJson = (): HeadersInit => ({
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  });

  async function listDevices(): Promise<MpPointDevice[]> {
    const url = `${MP_POINT_API_BASE}/devices`;
    const res = await fetchFn(url, { method: 'GET', headers: headersJson() });
    await throwIfNotOk(res);
    const data = (await res.json()) as Record<string, unknown>;
    const list = data.devices;
    if (!Array.isArray(list)) return [];
    return list.map((item) => normalizeDevice(item as Record<string, unknown>));
  }

  async function setDeviceMode(deviceId: string, mode: 'PDV' | 'STANDALONE'): Promise<void> {
    const url = `${MP_POINT_API_BASE}/devices/${encodeURIComponent(deviceId)}`;
    const res = await fetchFn(url, {
      method: 'PATCH',
      headers: headersJson(),
      body: JSON.stringify({ operating_mode: mode }),
    });
    await throwIfNotOk(res);
  }

  async function createPaymentIntent(
    deviceId: string,
    payload: CreateIntentPayload,
  ): Promise<MpPointPaymentIntent> {
    const url = `${MP_POINT_API_BASE}/devices/${encodeURIComponent(deviceId)}/payment-intents`;
    const res = await fetchFn(url, {
      method: 'POST',
      headers: headersJson(),
      body: JSON.stringify(payload),
    });
    await throwIfNotOk(res);
    const raw = (await res.json()) as Record<string, unknown>;
    return normalizePaymentIntent(raw);
  }

  async function getPaymentIntent(deviceId: string, intentId: string): Promise<MpPointPaymentIntent> {
    const url = `${MP_POINT_API_BASE}/devices/${encodeURIComponent(deviceId)}/payment-intents/${encodeURIComponent(intentId)}`;
    const res = await fetchFn(url, { method: 'GET', headers: headersJson() });
    await throwIfNotOk(res);
    const raw = (await res.json()) as Record<string, unknown>;
    return normalizePaymentIntent(raw);
  }

  async function cancelPaymentIntent(deviceId: string, intentId: string): Promise<void> {
    const url = `${MP_POINT_API_BASE}/devices/${encodeURIComponent(deviceId)}/payment-intents/${encodeURIComponent(intentId)}`;
    const res = await fetchFn(url, { method: 'DELETE', headers: headersJson() });
    await throwIfNotOk(res);
  }

  return {
    listDevices,
    setDeviceMode,
    createPaymentIntent,
    getPaymentIntent,
    cancelPaymentIntent,
  };
}
