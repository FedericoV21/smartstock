import { NextResponse } from 'next/server';

import { getTenantSession } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';
import { pluEfectivoProductoEnSucursal } from '@/lib/producto/plu-sucursal';
import { tenantPermiteBalanzaPorSucursal } from '@/lib/pos/prefs';

/**
 * Cuenta productos activos con PLU efectivo >= 10^digitos (no entran en una balanza que solo emite `digitos` dígitos).
 * Opcionalmente filtra por sucursal (considera overrides en `plu_sucursal` solo si el negocio activó la opción).
 */
export async function GET(request: Request) {
  const guard = await moduloGuard('facturador_pos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const { supabase, tenantId } = session;
  const url = new URL(request.url);
  const digitosRaw = url.searchParams.get('digitos');
  const sucursalId = url.searchParams.get('sucursal_id')?.trim() || null;
  const digitos = parseInt(digitosRaw ?? '', 10);

  if (!Number.isFinite(digitos) || digitos < 1 || digitos > 5) {
    return NextResponse.json({ error: 'Parámetro digitos inválido (usar 1 a 5).' }, { status: 400 });
  }

  if (digitos >= 5) {
    return NextResponse.json({ count: 0, digitos, sucursal_id: sucursalId });
  }

  const thresholdStr = String(10 ** digitos).padStart(5, '0');

  const { data: tenantRow } = await supabase
    .from('tenant')
    .select('pos_prefs')
    .eq('id', tenantId)
    .maybeSingle();
  const balanzaPorSucursal = tenantPermiteBalanzaPorSucursal(tenantRow?.pos_prefs);

  if (!sucursalId || !balanzaPorSucursal) {
    const { count, error } = await supabase
      .from('producto')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('activo', true)
      .not('plu', 'is', null)
      .gte('plu', thresholdStr);

    if (error) {
      console.error('[GET /api/productos/plu-fuera-de-rango]', error.message);
      return NextResponse.json({ error: 'No se pudo consultar el catálogo.' }, { status: 500 });
    }

    return NextResponse.json({ count: count ?? 0, digitos, sucursal_id: null });
  }

  const [{ data: productos }, { data: overrides }] = await Promise.all([
    supabase
      .from('producto')
      .select('id, plu')
      .eq('tenant_id', tenantId)
      .eq('activo', true)
      .not('plu', 'is', null),
    supabase
      .from('plu_sucursal')
      .select('producto_id, plu')
      .eq('tenant_id', tenantId)
      .eq('sucursal_id', sucursalId),
  ]);

  const overrideByProducto = new Map((overrides ?? []).map((r) => [r.producto_id, r.plu]));
  let count = 0;
  for (const p of productos ?? []) {
    const efectivo = pluEfectivoProductoEnSucursal(p.plu, overrideByProducto.get(p.id));
    if (efectivo && efectivo >= thresholdStr) count += 1;
  }

  return NextResponse.json({ count, digitos, sucursal_id: sucursalId });
}
