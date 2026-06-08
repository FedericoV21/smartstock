'use client';

import { normalizePosPrefs, POS_PREFS_KEY, type PosPrefs } from '@/lib/pos/prefs';

const MIGRATED_KEY = 'smartstock_pos_prefs_migrated';

export type EmisorTicketApi = {
  nombre_ticket: string;
  cuit: string | null;
  domicilio: string | null;
  logo_url: string | null;
};

export type PosPrefsApiResponse = {
  arca_configurado: boolean;
  sucursal_id: string | null;
  tenant_pos_prefs: PosPrefs;
  sucursal_pos_prefs: unknown | null;
  effective_pos_prefs: PosPrefs;
  emisor_ticket?: EmisorTicketApi;
};

/** Una sola lectura de prefs efectivas (alcance operativo del usuario). */
export async function fetchEffectivePosPrefsOnly(): Promise<PosPrefs> {
  const d = await fetchPosPrefsFromApi();
  if (d) return normalizePosPrefs(d.effective_pos_prefs);
  return normalizePosPrefs({});
}

export async function fetchPosPrefsFromApi(opts?: {
  sucursalId?: string | null;
  /** Pantalla /configuración: sin sucursal = solo defaults del tenant. */
  forConfig?: boolean;
}): Promise<PosPrefsApiResponse | null> {
  const params = new URLSearchParams();
  if (opts?.forConfig) params.set('for_config', '1');
  if (opts?.sucursalId != null && opts.sucursalId !== '') {
    params.set('sucursal_id', opts.sucursalId);
  }
  const q = params.toString();
  const res = await fetch(q ? `/api/configuracion/pos-prefs?${q}` : '/api/configuracion/pos-prefs', {
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const j = (await res.json()) as PosPrefsApiResponse;
  return {
    ...j,
    tenant_pos_prefs: normalizePosPrefs(j.tenant_pos_prefs),
    effective_pos_prefs: normalizePosPrefs(j.effective_pos_prefs),
  };
}

/** Si existían prefs solo en el navegador, las sube una vez a los defaults del negocio (solo admin). */
export async function migrateLegacyPosPrefsIfAdmin(isAdmin: boolean): Promise<void> {
  if (typeof window === 'undefined' || !isAdmin) return;
  if (localStorage.getItem(MIGRATED_KEY) === '1') return;
  const raw = localStorage.getItem(POS_PREFS_KEY);
  if (!raw) {
    localStorage.setItem(MIGRATED_KEY, '1');
    return;
  }
  let parsed: Partial<PosPrefs>;
  try {
    parsed = JSON.parse(raw) as Partial<PosPrefs>;
  } catch {
    localStorage.setItem(MIGRATED_KEY, '1');
    localStorage.removeItem(POS_PREFS_KEY);
    return;
  }
  const prefs = normalizePosPrefs(parsed);
  const res = await fetch('/api/configuracion/pos-prefs', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope: 'tenant', pos_prefs: prefs }),
  });
  if (res.ok) {
    localStorage.setItem(MIGRATED_KEY, '1');
    localStorage.removeItem(POS_PREFS_KEY);
  }
}

/** Quita la clave antigua para no mezclar con la config del servidor. */
export function clearLegacyPosPrefsStorage(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(POS_PREFS_KEY);
  if (!localStorage.getItem(MIGRATED_KEY)) localStorage.setItem(MIGRATED_KEY, '1');
}
