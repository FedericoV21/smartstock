import { NextResponse, type NextRequest } from 'next/server';

import { idsSucursalesOperables, resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession } from '@/lib/api/tenant-session';
import { promocionVigenteParaYmd } from '@/lib/facturacion/promociones';
import {
  filaPromocionAMotor,
  type PromocionRowConCombo,
} from '@/lib/promociones/servidor';
import { hoyEnAR } from '@/lib/utils/formatters';

const MIN_Q = 2;
const MAX_PROMOS = 20;
const FETCH_CAP = 40;

export type PosPromocionComboBusqueda = {
  id: string;
  nombre: string;
  precio_combo: number;
  combo_items: { producto_id: string; cantidad: number }[];
};

/**
 * Combo precio fijo por nombre (misma sede que el POS). Solo promos vigentes hoy AR.
 */
export async function GET(request: NextRequest) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const { supabase, tenantId } = session;

  const { searchParams } = new URL(request.url);
  const sucursalScope = await resolveAndValidateSucursalScope(
    session,
    searchParams.get('sucursal_id'),
  );
  if (!sucursalScope.ok) return sucursalScope.response;
  if (!sucursalScope.sucursalId) {
    return NextResponse.json(
      { error: 'No hay sucursal operativa seleccionada.' },
      { status: 400 },
    );
  }
  const sucursalId = sucursalScope.sucursalId;

  const { data: modCfg } = await supabase
    .from('modulo_config')
    .select('facturador_pos')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (!modCfg?.facturador_pos) {
    return NextResponse.json(
      { error: "El módulo 'facturador_pos' no está habilitado para tu plan." },
      { status: 403 },
    );
  }

  const operable = await idsSucursalesOperables(session);
  if (!operable.ok) return operable.response;
  if (operable.ids.length === 0) {
    return NextResponse.json(
      { error: 'No tenés sucursales asignadas para operar el POS.' },
      { status: 403 },
    );
  }

  const raw = searchParams.get('q')?.trim() ?? '';
  const q = raw.replace(/[,()%_\\'"]/g, ' ').replace(/\s+/g, ' ').trim();
  if (q.length < MIN_Q) {
    return NextResponse.json({ promociones: [] as PosPromocionComboBusqueda[] });
  }

  const { data: accessRows, error: accessErr } = await supabase
    .from('promocion_sucursal')
    .select('promocion_id')
    .eq('tenant_id', tenantId)
    .eq('sucursal_id', sucursalId);

  if (accessErr) {
    return NextResponse.json({ error: accessErr.message }, { status: 500 });
  }

  const promoIdsSucursal = [
    ...new Set((accessRows ?? []).map((row) => row.promocion_id).filter(Boolean)),
  ];
  if (promoIdsSucursal.length === 0) {
    return NextResponse.json({ promociones: [] as PosPromocionComboBusqueda[] });
  }

  const { data: promoRows, error: promoErr } = await supabase
    .from('promocion')
    .select(
      'id, nombre, tipo, activa, cantidad_lleva, cantidad_paga, unidad_descuento, porcentaje, cantidad_minima, rangos_volumen, precio_combo, vigente_desde, vigente_hasta, dias_semana, updated_at',
    )
    .eq('tenant_id', tenantId)
    .in('id', promoIdsSucursal)
    .eq('tipo', 'combo_precio_fijo')
    .eq('activa', true)
    .ilike('nombre', `%${q}%`)
    .order('nombre')
    .limit(FETCH_CAP);

  if (promoErr) {
    return NextResponse.json({ error: promoErr.message }, { status: 500 });
  }

  const rows = (promoRows ?? []) as PromocionRowConCombo[];
  if (rows.length === 0) {
    return NextResponse.json({ promociones: [] as PosPromocionComboBusqueda[] });
  }

  const ids = rows.map((r) => r.id);
  const { data: comboRows, error: comboErr } = await supabase
    .from('promocion_combo_item')
    .select('promocion_id, producto_id, cantidad')
    .eq('tenant_id', tenantId)
    .in('promocion_id', ids);

  if (comboErr) {
    return NextResponse.json({ error: comboErr.message }, { status: 500 });
  }

  type ComboRow = { promocion_id: string; producto_id: string; cantidad: number };
  const comboPorPromocion = new Map<string, { producto_id: string; cantidad: number }[]>();
  for (const r of (comboRows ?? []) as ComboRow[]) {
    const arr = comboPorPromocion.get(r.promocion_id) ?? [];
    arr.push({ producto_id: r.producto_id, cantidad: Number(r.cantidad) });
    comboPorPromocion.set(r.promocion_id, arr);
  }
  for (const arr of comboPorPromocion.values()) {
    arr.sort((a, b) => a.producto_id.localeCompare(b.producto_id));
  }

  const fecha = hoyEnAR();
  const promociones: PosPromocionComboBusqueda[] = [];

  for (const pr of rows) {
    const combo = comboPorPromocion.get(pr.id) ?? [];
    const prConCombo: PromocionRowConCombo = {
      ...pr,
      promocion_combo_item: combo.length ? combo : null,
    };
    const motor = filaPromocionAMotor(prConCombo);
    if (!promocionVigenteParaYmd(motor, fecha)) continue;
    if (!motor.combo_items?.length || motor.precio_combo == null) continue;
    promociones.push({
      id: motor.id,
      nombre: motor.nombre,
      precio_combo: Number(motor.precio_combo),
      combo_items: motor.combo_items,
    });
    if (promociones.length >= MAX_PROMOS) break;
  }

  return NextResponse.json({ promociones });
}
