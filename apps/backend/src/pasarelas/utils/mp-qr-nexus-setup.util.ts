export const MP_QR_NEXUS_POS_NAME = 'QR NEXUS';

const MP_API_BASE = 'https://api.mercadopago.com';

type MpFetch = typeof fetch;

export class MpQrSetupError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string = `http_${status}`,
    public readonly details: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = 'MpQrSetupError';
  }
}

export type MpQrAccountInfo = {
  id: string;
  nickname: string | null;
  site_id: string | null;
};

export type MpQrStoreOption = {
  id: string;
  name: string;
  external_id: string | null;
  date_creation: string | null;
  location_label: string | null;
};

export type MpQrPosOption = {
  id: string;
  name: string;
  external_id: string | null;
  external_store_id: string | null;
  store_id: string | null;
  fixed_amount: boolean;
  status: string | null;
  qr: Record<string, unknown> | null;
};

export type MpQrPreparedSetup = {
  account: MpQrAccountInfo;
  store: MpQrStoreOption;
  pos: MpQrPosOption;
  external_store_id: string;
  external_store_id_assigned: boolean;
  pos_created: boolean;
};

export type MpQrSetupOptions = {
  fetchImpl?: MpFetch;
};

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const t = String(value).trim();
  return t ? t : null;
}

function normalizeExternalId(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function authHeaders(accessToken: string): HeadersInit {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  };
}

function jsonHeaders(accessToken: string): HeadersInit {
  return {
    ...authHeaders(accessToken),
    'Content-Type': 'application/json',
  };
}

function getFetch(options?: MpQrSetupOptions): MpFetch {
  return options?.fetchImpl ?? globalThis.fetch;
}

async function readError(res: Response): Promise<{ message: string; code: string; details: Record<string, unknown> | null }> {
  const text = await res.text();
  const preview = text.trim().replace(/\s+/g, ' ').slice(0, 300);
  if (!preview) return { message: `HTTP ${res.status}`, code: `http_${res.status}`, details: null };

  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    const message =
      cleanString(data.message) ??
      cleanString(data.error) ??
      cleanString(data.cause) ??
      preview;
    const code = cleanString(data.code) ?? cleanString(data.error) ?? `http_${res.status}`;
    return { message, code, details: data };
  } catch {
    return { message: preview, code: `http_${res.status}`, details: { preview } };
  }
}

async function jsonOrThrow<T>(res: Response, fallbackMessage: string): Promise<T> {
  if (!res.ok) {
    const err = await readError(res);
    throw new MpQrSetupError(err.message || fallbackMessage, res.status, err.code, err.details);
  }
  const text = await res.text();
  if (!text.trim()) return {} as T;
  return JSON.parse(text) as T;
}

function rawStoreToOption(raw: Record<string, unknown>): MpQrStoreOption | null {
  const id = cleanString(raw.id);
  if (!id) return null;
  const location = raw.location && typeof raw.location === 'object' ? (raw.location as Record<string, unknown>) : {};
  return {
    id,
    name: cleanString(raw.name) ?? `Sucursal ${id}`,
    external_id: cleanString(raw.external_id),
    date_creation: cleanString(raw.date_creation) ?? cleanString(raw.date_created),
    location_label: cleanString(location.address_line) ?? cleanString(location.reference),
  };
}

function rawPosToOption(raw: Record<string, unknown>): MpQrPosOption | null {
  const id = cleanString(raw.id);
  if (!id) return null;
  return {
    id,
    name: cleanString(raw.name) ?? `Caja ${id}`,
    external_id: cleanString(raw.external_id),
    external_store_id: cleanString(raw.external_store_id),
    store_id: cleanString(raw.store_id),
    fixed_amount: Boolean(raw.fixed_amount ?? raw.fixedAmount),
    status: cleanString(raw.status),
    qr: raw.qr && typeof raw.qr === 'object' && !Array.isArray(raw.qr) ? (raw.qr as Record<string, unknown>) : null,
  };
}

function extractResults(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    if (data.length === 1 && data[0] && typeof data[0] === 'object') {
      const nested = (data[0] as Record<string, unknown>).results;
      if (Array.isArray(nested)) return nested as Record<string, unknown>[];
    }
    return data.filter((row) => row && typeof row === 'object') as Record<string, unknown>[];
  }
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.results)) return obj.results as Record<string, unknown>[];
    if (Array.isArray(obj.data)) return obj.data as Record<string, unknown>[];
  }
  return [];
}

export async function getMpQrAccountInfo(accessToken: string, options?: MpQrSetupOptions): Promise<MpQrAccountInfo> {
  const fetchFn = getFetch(options);
  const res = await fetchFn(`${MP_API_BASE}/users/me`, {
    method: 'GET',
    headers: authHeaders(accessToken),
  });
  const data = await jsonOrThrow<Record<string, unknown>>(res, 'No se pudo validar el token de Mercado Pago');
  const id = cleanString(data.id);
  if (!id) {
    throw new MpQrSetupError('Mercado Pago no devolvio user_id para este token', 502, 'missing_user_id', data);
  }
  return {
    id,
    nickname: cleanString(data.nickname),
    site_id: cleanString(data.site_id),
  };
}

export async function listMpQrStores(
  accessToken: string,
  userId: string,
  options?: MpQrSetupOptions,
): Promise<MpQrStoreOption[]> {
  const fetchFn = getFetch(options);
  const url = `${MP_API_BASE}/users/${encodeURIComponent(userId)}/stores/search?limit=100`;
  const res = await fetchFn(url, { method: 'GET', headers: authHeaders(accessToken) });
  const data = await jsonOrThrow<unknown>(res, 'No se pudieron listar los locales de Mercado Pago');
  return extractResults(data)
    .map(rawStoreToOption)
    .filter((store): store is MpQrStoreOption => store != null);
}

export async function listMpQrPos(
  accessToken: string,
  storeId?: string | null,
  options?: MpQrSetupOptions,
): Promise<MpQrPosOption[]> {
  const fetchFn = getFetch(options);
  const params = new URLSearchParams({ limit: '100' });
  if (storeId) params.set('store_id', storeId);
  const res = await fetchFn(`${MP_API_BASE}/pos?${params.toString()}`, {
    method: 'GET',
    headers: authHeaders(accessToken),
  });
  const data = await jsonOrThrow<unknown>(res, 'No se pudieron listar las cajas de Mercado Pago');
  return extractResults(data)
    .map(rawPosToOption)
    .filter((pos): pos is MpQrPosOption => pos != null);
}

function nextExternalStoreId(stores: MpQrStoreOption[], selectedStoreId: string): string {
  const used = new Set(
    stores
      .filter((store) => store.id !== selectedStoreId)
      .map((store) => store.external_id)
      .filter((value): value is string => value != null)
      .map((value) => value.toUpperCase()),
  );
  for (let i = 1; i <= 99; i += 1) {
    const candidate = `SUC${String(i).padStart(2, '0')}`;
    if (!used.has(candidate)) return candidate;
  }
  return `SUC${Date.now().toString().slice(-8)}`;
}

export async function ensureMpQrStoreExternalId(params: {
  accessToken: string;
  userId: string;
  store: MpQrStoreOption;
  allStores: MpQrStoreOption[];
  options?: MpQrSetupOptions;
}): Promise<{ store: MpQrStoreOption; external_store_id: string; assigned: boolean }> {
  if (params.store.external_id) {
    return { store: params.store, external_store_id: params.store.external_id, assigned: false };
  }

  const fetchFn = getFetch(params.options);
  const externalId = nextExternalStoreId(params.allStores, params.store.id);
  const res = await fetchFn(
    `${MP_API_BASE}/users/${encodeURIComponent(params.userId)}/stores/${encodeURIComponent(params.store.id)}`,
    {
      method: 'PUT',
      headers: jsonHeaders(params.accessToken),
      body: JSON.stringify({
        name: params.store.name,
        external_id: externalId,
      }),
    },
  );
  const updated = await jsonOrThrow<Record<string, unknown>>(res, 'No se pudo asignar external_id al local');
  const normalized = rawStoreToOption({ ...updated, id: updated.id ?? params.store.id }) ?? {
    ...params.store,
    external_id: externalId,
  };
  return {
    store: normalized,
    external_store_id: normalized.external_id ?? externalId,
    assigned: true,
  };
}

function sameName(a: string, b: string): boolean {
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

function nextExternalPosId(externalStoreId: string, existing: MpQrPosOption[]): string {
  const used = new Set(
    existing
      .map((pos) => pos.external_id)
      .filter((value): value is string => value != null)
      .map((value) => value.toUpperCase()),
  );
  const storePrefix = normalizeExternalId(externalStoreId).slice(0, 24) || 'SUC01';
  const base = `${storePrefix}QRNEXUS`.slice(0, 40);
  if (!used.has(base)) return base;
  for (let i = 2; i <= 99; i += 1) {
    const suffix = String(i);
    const candidate = `${base.slice(0, 40 - suffix.length)}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base.slice(0, 32)}${Date.now().toString().slice(-8)}`;
}

export async function ensureMpQrNexusPos(params: {
  accessToken: string;
  storeId: string;
  externalStoreId: string;
  options?: MpQrSetupOptions;
}): Promise<{ pos: MpQrPosOption; created: boolean }> {
  const fetchFn = getFetch(params.options);
  const existing = await listMpQrPos(params.accessToken, params.storeId, params.options);
  const reusable = existing.find((pos) => sameName(pos.name, MP_QR_NEXUS_POS_NAME) && pos.external_id);
  if (reusable?.external_id) return { pos: reusable, created: false };

  const externalPosId = nextExternalPosId(params.externalStoreId, existing);
  const res = await fetchFn(`${MP_API_BASE}/pos`, {
    method: 'POST',
    headers: jsonHeaders(params.accessToken),
    body: JSON.stringify({
      name: MP_QR_NEXUS_POS_NAME,
      fixed_amount: true,
      store_id: params.storeId,
      external_store_id: params.externalStoreId,
      external_id: externalPosId,
    }),
  });

  if (res.status === 409) {
    const refreshed = await listMpQrPos(params.accessToken, params.storeId, params.options);
    const match = refreshed.find((pos) => pos.external_id === externalPosId);
    if (match) return { pos: match, created: false };
  }

  const created = await jsonOrThrow<Record<string, unknown>>(res, 'No se pudo crear la caja QR NEXUS');
  const pos = rawPosToOption({
    ...created,
    external_id: created.external_id ?? externalPosId,
    external_store_id: created.external_store_id ?? params.externalStoreId,
    store_id: created.store_id ?? params.storeId,
    fixed_amount: created.fixed_amount ?? true,
  });
  if (!pos?.external_id) {
    throw new MpQrSetupError('Mercado Pago creo la caja, pero no devolvio external_pos_id', 502, 'missing_pos_external_id', created);
  }
  return { pos, created: true };
}

export async function prepareMpQrNexusSetup(params: {
  accessToken: string;
  storeId: string;
  options?: MpQrSetupOptions;
}): Promise<MpQrPreparedSetup> {
  const account = await getMpQrAccountInfo(params.accessToken, params.options);
  const stores = await listMpQrStores(params.accessToken, account.id, params.options);
  const store = stores.find((row) => row.id === params.storeId);
  if (!store) {
    throw new MpQrSetupError('El local seleccionado no existe para este access token', 404, 'store_not_found');
  }

  const ensuredStore = await ensureMpQrStoreExternalId({
    accessToken: params.accessToken,
    userId: account.id,
    store,
    allStores: stores,
    options: params.options,
  });
  const ensuredPos = await ensureMpQrNexusPos({
    accessToken: params.accessToken,
    storeId: ensuredStore.store.id,
    externalStoreId: ensuredStore.external_store_id,
    options: params.options,
  });

  return {
    account,
    store: ensuredStore.store,
    pos: ensuredPos.pos,
    external_store_id: ensuredStore.external_store_id,
    external_store_id_assigned: ensuredStore.assigned,
    pos_created: ensuredPos.created,
  };
}
