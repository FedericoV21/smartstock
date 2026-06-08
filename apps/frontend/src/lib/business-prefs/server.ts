import {
  effectiveBusinessPrefsFromRows,
  normalizeBusinessPrefs,
  type BusinessPrefs,
} from '@/lib/business-prefs/prefs';
import type { Database } from '@/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Lee las preferencias de negocio efectivas del lado servidor.
 * Si `sucursalId` está presente, mezcla el override de la sucursal sobre los defaults del tenant.
 */
export async function loadEffectiveBusinessPrefsForUsuario(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  usuarioId: string,
): Promise<BusinessPrefs> {
  const { data: usuario } = await supabase
    .from('usuario')
    .select('sucursal_default_id')
    .eq('id', usuarioId)
    .maybeSingle();
  const sid = (usuario as { sucursal_default_id: string | null } | null)?.sucursal_default_id ?? null;
  return loadEffectiveBusinessPrefs(supabase, tenantId, sid);
}

export async function loadEffectiveBusinessPrefs(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  sucursalId: string | null,
): Promise<BusinessPrefs> {
  const { data: tenantRow } = await supabase
    .from('tenant')
    .select('business_prefs')
    .eq('id', tenantId)
    .maybeSingle();

  const tenantPrefs = (tenantRow as { business_prefs: unknown } | null)?.business_prefs ?? null;

  if (!sucursalId) {
    return normalizeBusinessPrefs(tenantPrefs);
  }

  const { data: sucursalRow } = await supabase
    .from('sucursal')
    .select('business_prefs')
    .eq('id', sucursalId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  const sucursalPrefs = (sucursalRow as { business_prefs: unknown } | null)?.business_prefs ?? null;
  return effectiveBusinessPrefsFromRows(tenantPrefs, sucursalPrefs);
}
