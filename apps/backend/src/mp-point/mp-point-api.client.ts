import type {
  CreateIntentPayload,
  MpPointClient,
  MpPointDevice,
  MpPointPaymentIntent,
} from './types/mp-point.types';
import {
  MP_POINT_API_BASE,
  mpPointJsonHeaders,
  throwIfMpNotOk,
  type MpFetch,
} from './utils/mp-point-http.util';
import {
  normalizeMpPointDevice,
  normalizeMpPointPaymentIntent,
} from './utils/mp-point-normalize.util';

export { MP_POINT_API_BASE };

export interface GetMpPointClientOptions {
  /** Inyectable para tests. Por defecto `globalThis.fetch`. */
  fetchImpl?: MpFetch;
}

export function createMpPointClient(
  accessToken: string,
  options?: GetMpPointClientOptions,
): MpPointClient {
  const fetchFn: MpFetch = options?.fetchImpl ?? globalThis.fetch;
  const headersJson = () => mpPointJsonHeaders(accessToken);

  async function listDevices(): Promise<MpPointDevice[]> {
    const url = `${MP_POINT_API_BASE}/devices`;
    const res = await fetchFn(url, { method: 'GET', headers: headersJson() });
    await throwIfMpNotOk(res);
    const data = (await res.json()) as Record<string, unknown>;
    const list = data.devices;
    if (!Array.isArray(list)) return [];
    return list.map((item) => normalizeMpPointDevice(item as Record<string, unknown>));
  }

  async function setDeviceMode(deviceId: string, mode: 'PDV' | 'STANDALONE'): Promise<void> {
    const url = `${MP_POINT_API_BASE}/devices/${encodeURIComponent(deviceId)}`;
    const res = await fetchFn(url, {
      method: 'PATCH',
      headers: headersJson(),
      body: JSON.stringify({ operating_mode: mode }),
    });
    await throwIfMpNotOk(res);
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
    await throwIfMpNotOk(res);
    const raw = (await res.json()) as Record<string, unknown>;
    return normalizeMpPointPaymentIntent(raw);
  }

  async function getPaymentIntent(_deviceId: string, intentId: string): Promise<MpPointPaymentIntent> {
    void _deviceId;
    const url = `${MP_POINT_API_BASE}/payment-intents/${encodeURIComponent(intentId)}`;
    const res = await fetchFn(url, { method: 'GET', headers: headersJson() });
    await throwIfMpNotOk(res);
    const raw = (await res.json()) as Record<string, unknown>;
    return normalizeMpPointPaymentIntent(raw);
  }

  async function cancelPaymentIntent(deviceId: string, intentId: string): Promise<void> {
    const url = `${MP_POINT_API_BASE}/devices/${encodeURIComponent(deviceId)}/payment-intents/${encodeURIComponent(intentId)}`;
    const res = await fetchFn(url, { method: 'DELETE', headers: headersJson() });
    await throwIfMpNotOk(res);
  }

  return {
    listDevices,
    setDeviceMode,
    createPaymentIntent,
    getPaymentIntent,
    cancelPaymentIntent,
  };
}
