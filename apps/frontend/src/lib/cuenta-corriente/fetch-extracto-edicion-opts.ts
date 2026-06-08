import type { SupabaseClient } from '@supabase/supabase-js';

import { loadEffectiveBusinessPrefs } from '@/lib/business-prefs/server';
import type { Database } from '@/types/database';

export async function resolveExtractoEdicionOpts(
  supabase: SupabaseClient<Database>,
  opts: {
    tenantId: string;
    rol: string;
    sucursalId: string | null;
  },
): Promise<{
  puedeEditar: boolean;
  liquidacionHabilitada: boolean;
  liquidacionPorSucursal: Record<string, boolean>;
}> {
  const puedeEditar = opts.rol !== 'visor';
  if (!puedeEditar) {
    return { puedeEditar: false, liquidacionHabilitada: false, liquidacionPorSucursal: {} };
  }
  if (opts.sucursalId) {
    const businessPrefs = await loadEffectiveBusinessPrefs(
      supabase,
      opts.tenantId,
      opts.sucursalId,
    );
    const on = businessPrefs.cuentaCorrienteDistribuidora.permitirLiquidacionItemsDia;
    return {
      puedeEditar,
      liquidacionHabilitada: on,
      liquidacionPorSucursal: on ? { [opts.sucursalId]: true } : {},
    };
  }
  const { data: sucursales } = await supabase
    .from('sucursal')
    .select('id')
    .eq('tenant_id', opts.tenantId)
    .eq('activa', true);
  const liquidacionPorSucursal: Record<string, boolean> = {};
  for (const s of sucursales ?? []) {
    const prefs = await loadEffectiveBusinessPrefs(supabase, opts.tenantId, s.id);
    if (prefs.cuentaCorrienteDistribuidora.permitirLiquidacionItemsDia) {
      liquidacionPorSucursal[s.id] = true;
    }
  }
  return { puedeEditar, liquidacionHabilitada: false, liquidacionPorSucursal };
}
