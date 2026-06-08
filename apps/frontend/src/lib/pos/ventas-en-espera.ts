/**
 * Multi-venta en POS — "ventas en espera" (V132-POS-001).
 *
 * Cada slice representa una venta en curso suspendida (carrito + cliente +
 * tipo de comprobante + ajustes + flags de cobro). Se persiste en localStorage
 * scoped por (tenant, caja, usuario) para que cambios de caja o cajero no
 * mezclen carritos ajenos. El POS expone hasta `MAX_VENTAS_EN_ESPERA`
 * pestañas en paralelo; se incluye la venta activa.
 *
 * El módulo es agnóstico al shape concreto de `state`: el caller (POS) lo
 * serializa cuando hace `snapshot` y lo recupera al `restore`. Esto evita
 * acoplar el lib a `CartItem` y similares (que viven en el archivo del POS).
 */

import type { Dispatch, SetStateAction } from 'react';

export const MAX_VENTAS_EN_ESPERA = 4;
const SCHEMA_VERSION = 1;
const STORAGE_KEY_PREFIX = `nexus.pos.ventasEnEspera.v${SCHEMA_VERSION}.`;
const LEGACY_CART_PREFIX = 'smartstock_pos_cart_';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const POS_VENTAS_EN_ESPERA_EVENT = 'nexus:pos-ventas-en-espera-changed';

export type CobroDigitalEnCurso = 'mp_point' | 'mp_qr' | null;

export interface VentaEnEsperaSlice<TState = unknown> {
  id: string;
  /** Etiqueta opcional definida por el cajero ("Juan tarjeta", "Mesa 4"). */
  label?: string;
  /** Total visible en la pestaña (cacheado; se recalcula al snapshot). */
  total: number;
  /** Cantidad de líneas, para la pestaña vacía vs en curso. */
  itemCount: number;
  /** Si la pestaña tiene un cobro Point/QR en curso, bloquea iniciar otro digital en otras. */
  cobroDigitalEnCurso: CobroDigitalEnCurso;
  createdAt: number;
  updatedAt: number;
  /** Estado serializable del carrito (items, cliente, tipo, ajustes...). */
  state: TState;
}

export interface VentasEnEsperaState<TState = unknown> {
  schemaVersion: number;
  activeId: string;
  slices: VentaEnEsperaSlice<TState>[];
  updatedAt: number;
}

export interface VentasEnEsperaScope {
  tenantId: string;
  cajaId: string;
  userId: string;
}

function normalizeScopeFragment(value: string): string {
  return value.trim() || '_';
}

export function ventasEnEsperaStorageKey(scope: VentasEnEsperaScope): string {
  const t = normalizeScopeFragment(scope.tenantId);
  const c = normalizeScopeFragment(scope.cajaId);
  const u = normalizeScopeFragment(scope.userId);
  return `${STORAGE_KEY_PREFIX}${t}.${c}.${u}`;
}

function safeRandomId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* noop */
  }
  return `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createEmptySlice<TState>(initialState: TState): VentaEnEsperaSlice<TState> {
  const now = Date.now();
  return {
    id: safeRandomId(),
    total: 0,
    itemCount: 0,
    cobroDigitalEnCurso: null,
    createdAt: now,
    updatedAt: now,
    state: initialState,
  };
}

export function createInitialState<TState>(initialState: TState): VentasEnEsperaState<TState> {
  const slice = createEmptySlice(initialState);
  return {
    schemaVersion: SCHEMA_VERSION,
    activeId: slice.id,
    slices: [slice],
    updatedAt: slice.updatedAt,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseStoredState<TState>(raw: string): VentasEnEsperaState<TState> | null {
  try {
    const data = JSON.parse(raw) as unknown;
    if (!isObject(data)) return null;
    if (typeof data.schemaVersion !== 'number' || data.schemaVersion !== SCHEMA_VERSION) return null;
    if (typeof data.activeId !== 'string') return null;
    if (!Array.isArray(data.slices)) return null;
    const updatedAt = typeof data.updatedAt === 'number' ? data.updatedAt : Date.now();
    if (Date.now() - updatedAt > MAX_AGE_MS) return null;

    const slices: VentaEnEsperaSlice<TState>[] = [];
    for (const raw of data.slices) {
      if (!isObject(raw)) continue;
      if (typeof raw.id !== 'string') continue;
      slices.push({
        id: raw.id,
        label: typeof raw.label === 'string' ? raw.label : undefined,
        total: typeof raw.total === 'number' && Number.isFinite(raw.total) ? raw.total : 0,
        itemCount:
          typeof raw.itemCount === 'number' && Number.isFinite(raw.itemCount)
            ? Math.max(0, Math.round(raw.itemCount))
            : 0,
        cobroDigitalEnCurso:
          raw.cobroDigitalEnCurso === 'mp_point' || raw.cobroDigitalEnCurso === 'mp_qr'
            ? raw.cobroDigitalEnCurso
            : null,
        createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : updatedAt,
        updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : updatedAt,
        state: raw.state as TState,
      });
    }
    if (slices.length === 0) return null;
    const activeId = slices.some((s) => s.id === data.activeId) ? data.activeId : slices[0]!.id;

    return {
      schemaVersion: SCHEMA_VERSION,
      activeId,
      slices: slices.slice(0, MAX_VENTAS_EN_ESPERA),
      updatedAt,
    };
  } catch {
    return null;
  }
}

export function loadVentasEnEsperaState<TState>(
  scope: VentasEnEsperaScope,
): VentasEnEsperaState<TState> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(ventasEnEsperaStorageKey(scope));
    if (!raw) return null;
    return parseStoredState<TState>(raw);
  } catch {
    return null;
  }
}

export function saveVentasEnEsperaState<TState>(
  scope: VentasEnEsperaScope,
  state: VentasEnEsperaState<TState>,
): void {
  if (typeof window === 'undefined') return;
  const payload: VentasEnEsperaState<TState> = {
    ...state,
    schemaVersion: SCHEMA_VERSION,
    updatedAt: Date.now(),
    slices: state.slices.slice(0, MAX_VENTAS_EN_ESPERA),
  };
  try {
    window.localStorage.setItem(ventasEnEsperaStorageKey(scope), JSON.stringify(payload));
    notifyVentasEnEsperaChanged();
  } catch {
    /* full o unavailable */
  }
}

export function clearVentasEnEsperaState(scope: VentasEnEsperaScope): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(ventasEnEsperaStorageKey(scope));
    notifyVentasEnEsperaChanged();
  } catch {
    /* noop */
  }
}

/**
 * Reducer-style helpers para mantener consistente el estado en el caller.
 * Cada función devuelve un estado nuevo; el caller hace `setEstado(next)` y
 * después `saveVentasEnEsperaState(scope, next)`.
 */
export function setActiveSlice<TState>(
  state: VentasEnEsperaState<TState>,
  sliceId: string,
): VentasEnEsperaState<TState> {
  if (!state.slices.some((s) => s.id === sliceId)) return state;
  if (state.activeId === sliceId) return state;
  return { ...state, activeId: sliceId, updatedAt: Date.now() };
}

export function upsertActiveSlice<TState>(
  state: VentasEnEsperaState<TState>,
  patch: Partial<Omit<VentaEnEsperaSlice<TState>, 'id' | 'createdAt'>> & { state?: TState },
): VentasEnEsperaState<TState> {
  const idx = state.slices.findIndex((s) => s.id === state.activeId);
  if (idx < 0) return state;
  const now = Date.now();
  const current = state.slices[idx]!;
  const merged: VentaEnEsperaSlice<TState> = {
    ...current,
    ...patch,
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: now,
  };
  const slices = [...state.slices];
  slices[idx] = merged;
  return { ...state, slices, updatedAt: now };
}

export function createSlice<TState>(
  state: VentasEnEsperaState<TState>,
  initialState: TState,
): { state: VentasEnEsperaState<TState>; newId: string | null } {
  if (state.slices.length >= MAX_VENTAS_EN_ESPERA) return { state, newId: null };
  const slice = createEmptySlice(initialState);
  return {
    state: {
      ...state,
      activeId: slice.id,
      slices: [...state.slices, slice],
      updatedAt: slice.updatedAt,
    },
    newId: slice.id,
  };
}

export function closeSlice<TState>(
  state: VentasEnEsperaState<TState>,
  sliceId: string,
  fallbackState: TState,
): VentasEnEsperaState<TState> {
  const slices = state.slices.filter((s) => s.id !== sliceId);
  if (slices.length === 0) {
    return createInitialState(fallbackState);
  }
  const wasActive = state.activeId === sliceId;
  const activeId = wasActive ? slices[slices.length - 1]!.id : state.activeId;
  return { ...state, activeId, slices, updatedAt: Date.now() };
}

/**
 * Migración del carrito legacy (`smartstock_pos_cart_{tenantId}`) a una slice.
 * Devuelve null si no hay carrito viejo persistido para este tenant.
 */
export function legacyCartRawForTenant(tenantId: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(`${LEGACY_CART_PREFIX}${tenantId}`);
  } catch {
    return null;
  }
}

export function dropLegacyCartForTenant(tenantId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(`${LEGACY_CART_PREFIX}${tenantId}`);
  } catch {
    /* noop */
  }
}

/**
 * Cuenta ventas en espera del tenant entero (todas las cajas/cajeros) para
 * mostrar un badge global en la sidebar. Solo cuenta las slices con `itemCount > 0`.
 */
export function countVentasEnEsperaParaTenant(tenantId: string): number {
  if (typeof window === 'undefined' || !tenantId) return 0;
  const tenantFragment = `${STORAGE_KEY_PREFIX}${normalizeScopeFragment(tenantId)}.`;
  let total = 0;
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith(tenantFragment)) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const parsed = parseStoredState<unknown>(raw);
      if (!parsed) continue;
      for (const slice of parsed.slices) {
        if (slice.itemCount > 0) total += 1;
      }
    }
  } catch {
    return 0;
  }
  return total;
}

function notifyVentasEnEsperaChanged() {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(POS_VENTAS_EN_ESPERA_EVENT));
  } catch {
    /* noop */
  }
}

/**
 * Suscripción al evento (mismo tab) + `storage` (otros tabs / cajas). Devuelve
 * una función para desuscribirse.
 */
export function subscribeVentasEnEsperaChanges(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onCustom = () => handler();
  const onStorage = (ev: StorageEvent) => {
    if (!ev.key || ev.key.startsWith(STORAGE_KEY_PREFIX)) handler();
  };
  window.addEventListener(POS_VENTAS_EN_ESPERA_EVENT, onCustom);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(POS_VENTAS_EN_ESPERA_EVENT, onCustom);
    window.removeEventListener('storage', onStorage);
  };
}

/**
 * Azúcar para usar con `setState` en el POS: aplica un updater y persiste en LS.
 */
export function persistVentasEnEsperaSetter<TState>(
  scope: VentasEnEsperaScope,
  setState: Dispatch<SetStateAction<VentasEnEsperaState<TState>>>,
  updater: (prev: VentasEnEsperaState<TState>) => VentasEnEsperaState<TState>,
): void {
  setState((prev) => {
    const next = updater(prev);
    if (next !== prev) saveVentasEnEsperaState(scope, next);
    return next;
  });
}
