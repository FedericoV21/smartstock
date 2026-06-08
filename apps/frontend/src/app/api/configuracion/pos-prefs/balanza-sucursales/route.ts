import { NextResponse } from 'next/server';

import { getTenantSession } from '@/lib/api/tenant-session';
import { createServiceRoleClient } from '@/lib/supabase/server';
import {
  effectivePosPrefsFromRows,
  finalizePosPrefsForStorage,
  normalizePosPrefs,
  sucursalTieneOverrideBalanza,
  type PosPrefs,
} from '@/lib/pos/prefs';

export type BalanzaSucursalRowApi = {
  sucursal_id: string;
  nombre: string;
  codigo: string;
  sucursal_pos_prefs: unknown | null;
  effective_pos_prefs: PosPrefs;
  balanza_override: boolean;
};

/**
 * GET: listado de sucursales con prefs efectivas de balanza (configuración centralizada).
 */
export async function GET() {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const db = createServiceRoleClient() as any;

  const { data: tenantRow, error: tErr } = await db
    .from('tenant')
    .select('pos_prefs')
    .eq('id', session.tenantId)
    .single();
  if (tErr || !tenantRow) {
    return NextResponse.json({ error: tErr?.message ?? 'Tenant no encontrado' }, { status: 500 });
  }

  const tenantNorm = finalizePosPrefsForStorage(
    normalizePosPrefs(
      tenantRow.pos_prefs && typeof tenantRow.pos_prefs === 'object' && !Array.isArray(tenantRow.pos_prefs)
        ? (tenantRow.pos_prefs as Partial<PosPrefs>)
        : {},
    ),
  );

  const { data: sucursales, error: sErr } = await db
    .from('sucursal')
    .select('id, nombre, codigo, pos_prefs')
    .eq('tenant_id', session.tenantId)
    .order('codigo', { ascending: true });
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });

  const rows: BalanzaSucursalRowApi[] = [];
  for (const s of sucursales ?? []) {
    const effective = effectivePosPrefsFromRows(tenantRow.pos_prefs, s.pos_prefs ?? null);
    rows.push({
      sucursal_id: s.id,
      nombre: String(s.nombre ?? ''),
      codigo: String(s.codigo ?? ''),
      sucursal_pos_prefs: s.pos_prefs ?? null,
      effective_pos_prefs: effective,
      balanza_override: sucursalTieneOverrideBalanza(tenantNorm, effective),
    });
  }

  return NextResponse.json({
    tenant_pos_prefs: tenantNorm,
    balanza_config_por_sucursal: tenantNorm.balanzaConfigPorSucursal === true,
    sucursales: rows,
  });
}
