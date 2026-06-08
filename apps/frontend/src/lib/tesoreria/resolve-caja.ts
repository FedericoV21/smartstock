import {
  effectiveBusinessPrefsFromRows,
  normalizeBusinessPrefs,
  type BusinessPrefs,
} from '@/lib/business-prefs/prefs';
import { createServiceRoleClient } from '@/lib/supabase/server';

import { provisionarCajasTesoreria, resolveCajaTesoreriaFilter, type CajaTesoreriaRow } from './constants';

type Db = ReturnType<typeof createServiceRoleClient>;

export async function fetchEffectiveBusinessPrefsForTesoreria(
  db: Db,
  tenantId: string,
  sucursalId: string | null,
): Promise<BusinessPrefs> {
  const { data: tenantRow } = await db.from('tenant').select('business_prefs').eq('id', tenantId).single();
  let sucursalPrefs: unknown | null = null;
  if (sucursalId) {
    const { data: sRow } = await db
      .from('sucursal')
      .select('business_prefs')
      .eq('id', sucursalId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    sucursalPrefs = sRow?.business_prefs ?? null;
  }
  return effectiveBusinessPrefsFromRows(tenantRow?.business_prefs, sucursalPrefs);
}

export async function ensureTesoreriaHabilitada(
  db: Db,
  tenantId: string,
  sucursalId: string | null,
): Promise<{ ok: true; prefs: BusinessPrefs } | { ok: false; error: string; status: number }> {
  const prefs = await fetchEffectiveBusinessPrefsForTesoreria(db, tenantId, sucursalId);
  if (!prefs.cajaInterna.habilitado) {
    return { ok: false, error: 'La caja interna no está habilitada.', status: 403 };
  }
  return { ok: true, prefs };
}

export async function resolveCajaTesoreriaActiva(
  db: Db,
  tenantId: string,
  prefs: BusinessPrefs,
  sucursalId: string | null,
): Promise<{ ok: true; caja: CajaTesoreriaRow } | { ok: false; error: string; status: number }> {
  let filter: { sucursal_id: null } | { sucursal_id: string };
  try {
    filter = resolveCajaTesoreriaFilter(prefs.cajaInterna.alcance, sucursalId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Sucursal requerida.', status: 400 };
  }

  let q = (db as any)
    .from('caja_tesoreria')
    .select('id, tenant_id, sucursal_id, nombre, activa')
    .eq('tenant_id', tenantId)
    .eq('activa', true);

  if (filter.sucursal_id === null) {
    q = q.is('sucursal_id', null);
  } else {
    q = q.eq('sucursal_id', filter.sucursal_id);
  }

  const { data, error } = await q.maybeSingle();
  if (error) return { ok: false, error: error.message, status: 500 };
  if (!data) {
    const prov = await provisionarCajasTesoreria(db as any, tenantId, prefs.cajaInterna);
    if (!prov.ok) return { ok: false, error: prov.error, status: 500 };
    const retry = await q.maybeSingle();
    if (retry.error || !retry.data) {
      return { ok: false, error: 'Caja de tesorería no encontrada.', status: 404 };
    }
    return { ok: true, caja: retry.data as CajaTesoreriaRow };
  }
  return { ok: true, caja: data as CajaTesoreriaRow };
}

export async function syncTesoreriaOnBusinessPrefsChange(
  db: Db,
  tenantId: string,
  businessPrefs: Partial<BusinessPrefs> | BusinessPrefs,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const norm = normalizeBusinessPrefs(businessPrefs);
  if (!norm.cajaInterna.habilitado) return { ok: true };
  return provisionarCajasTesoreria(db as any, tenantId, norm.cajaInterna);
}

export async function fetchSaldoEfectivoTesoreria(
  db: Db,
  cajaTesoreriaId: string,
): Promise<number> {
  const { data, error } = await (db as any).rpc('saldo_efectivo_caja_tesoreria', {
    p_caja_tesoreria_id: cajaTesoreriaId,
  });
  if (error) throw new Error(error.message);
  const n = Number(data ?? 0);
  return Number.isFinite(n) ? n : 0;
}
