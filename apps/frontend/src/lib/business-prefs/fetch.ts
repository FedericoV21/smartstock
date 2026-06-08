import { normalizeBusinessPrefs, type BusinessPrefs } from '@/lib/business-prefs/prefs';

export type BusinessPrefsApiResponse = {
  sucursal_id: string | null;
  tenant_business_prefs: BusinessPrefs;
  sucursal_business_prefs: unknown | null;
  effective_business_prefs: BusinessPrefs;
};

/** Una sola lectura de prefs efectivas (alcance operativo del usuario). */
export async function fetchEffectiveBusinessPrefsOnly(): Promise<BusinessPrefs> {
  const d = await fetchBusinessPrefsFromApi();
  if (d) return normalizeBusinessPrefs(d.effective_business_prefs);
  return normalizeBusinessPrefs({});
}

export async function fetchBusinessPrefsFromApi(opts?: {
  sucursalId?: string | null;
  /** Pantalla /configuración: sin sucursal = solo defaults del tenant. */
  forConfig?: boolean;
}): Promise<BusinessPrefsApiResponse | null> {
  const params = new URLSearchParams();
  if (opts?.forConfig) params.set('for_config', '1');
  if (opts?.sucursalId != null && opts.sucursalId !== '') {
    params.set('sucursal_id', opts.sucursalId);
  }
  const q = params.toString();
  const url = q ? `/api/configuracion/business-prefs?${q}` : '/api/configuracion/business-prefs';
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return null;
  const j = (await res.json()) as BusinessPrefsApiResponse;
  return {
    ...j,
    tenant_business_prefs: normalizeBusinessPrefs(j.tenant_business_prefs),
    effective_business_prefs: normalizeBusinessPrefs(j.effective_business_prefs),
  };
}
