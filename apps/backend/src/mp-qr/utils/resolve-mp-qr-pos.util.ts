import { MP_QR_API_BASE } from '../mp-qr-api.client';

const MP_POS_LIST = `${MP_QR_API_BASE}/pos`;
const MP_STORES_BASE = `${MP_QR_API_BASE}/stores`;

type MpFetch = typeof fetch;

export type MpQrResolvedPos = {
  external_pos_id: string;
  external_store_id: string | null;
  resolved_from_internal_id: boolean;
};

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const t = String(value).trim();
  return t ? t : null;
}

function cajaInfoFromRaw(raw: Record<string, unknown>) {
  return {
    id: Number(raw.id),
    name: String(raw.name ?? ''),
    external_id: cleanString(raw.external_id),
    store_id: cleanString(raw.store_id),
    external_store_id: cleanString(raw.external_store_id),
    fixed_amount: Boolean(raw.fixed_amount ?? raw.fixedAmount),
  };
}

function listarCajasDesdeJson(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    if (Array.isArray(o.results)) return o.results as Record<string, unknown>[];
    if (Array.isArray(o.data)) return o.data as Record<string, unknown>[];
  }
  return [];
}

async function loadExternalStoreId(params: {
  accessToken: string;
  storeId: string | null;
  configuredExternalStoreId?: string | null;
  fetchFn: MpFetch;
}): Promise<string | null> {
  const configured = cleanString(params.configuredExternalStoreId);
  if (configured) return configured;
  if (!params.storeId) return null;

  const res = await params.fetchFn(`${MP_STORES_BASE}/${encodeURIComponent(params.storeId)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${params.accessToken}` },
  });
  if (!res.ok) return null;
  try {
    const data = (await res.json()) as Record<string, unknown>;
    return cleanString(data.external_id);
  } catch {
    return null;
  }
}

export async function resolveMpQrPos(
  input: {
    access_token: string;
    user_id: string;
    external_pos_id: string;
    external_store_id?: string | null;
  },
  options?: { fetchImpl?: MpFetch },
): Promise<MpQrResolvedPos> {
  const fetchFn: MpFetch = options?.fetchImpl ?? globalThis.fetch;
  const requested = String(input.external_pos_id).trim();
  const configuredExternalStoreId = cleanString(input.external_store_id);

  if (!requested) {
    return {
      external_pos_id: requested,
      external_store_id: configuredExternalStoreId,
      resolved_from_internal_id: false,
    };
  }

  if (!/^\d+$/.test(requested)) {
    return {
      external_pos_id: requested,
      external_store_id: configuredExternalStoreId,
      resolved_from_internal_id: false,
    };
  }

  const posRes = await fetchFn(MP_POS_LIST, {
    method: 'GET',
    headers: { Authorization: `Bearer ${input.access_token}` },
  });
  if (!posRes.ok) {
    return {
      external_pos_id: requested,
      external_store_id: configuredExternalStoreId,
      resolved_from_internal_id: false,
    };
  }

  let posJson: unknown;
  try {
    posJson = await posRes.json();
  } catch {
    return {
      external_pos_id: requested,
      external_store_id: configuredExternalStoreId,
      resolved_from_internal_id: false,
    };
  }

  const cajas = listarCajasDesdeJson(posJson).map((raw) => ({
    raw,
    info: cajaInfoFromRaw(raw),
  }));

  const porExternalId = cajas.find((c) => c.info.external_id === requested);
  if (porExternalId?.info.external_id) {
    const externalStoreId =
      cleanString(porExternalId.info.external_store_id) ??
      (await loadExternalStoreId({
        accessToken: input.access_token,
        storeId: cleanString(porExternalId.info.store_id),
        configuredExternalStoreId,
        fetchFn,
      }));
    return {
      external_pos_id: porExternalId.info.external_id,
      external_store_id: externalStoreId,
      resolved_from_internal_id: false,
    };
  }

  const porIdInterno = cajas.find((c) => String(c.info.id) === requested);
  if (porIdInterno?.info.external_id) {
    const externalStoreId =
      cleanString(porIdInterno.info.external_store_id) ??
      (await loadExternalStoreId({
        accessToken: input.access_token,
        storeId: cleanString(porIdInterno.info.store_id),
        configuredExternalStoreId,
        fetchFn,
      }));
    return {
      external_pos_id: porIdInterno.info.external_id,
      external_store_id: externalStoreId,
      resolved_from_internal_id: true,
    };
  }

  return {
    external_pos_id: requested,
    external_store_id: configuredExternalStoreId,
    resolved_from_internal_id: false,
  };
}

export async function resolveMpQrExternalPosId(
  input: {
    access_token: string;
    user_id: string;
    external_pos_id: string;
  },
  options?: { fetchImpl?: MpFetch },
): Promise<{ external_pos_id: string; resolved_from_internal_id: boolean }> {
  const resolved = await resolveMpQrPos(input, options);
  return {
    external_pos_id: resolved.external_pos_id,
    resolved_from_internal_id: resolved.resolved_from_internal_id,
  };
}
