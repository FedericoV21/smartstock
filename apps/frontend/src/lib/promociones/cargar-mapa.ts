import type { SupabaseClient } from '@supabase/supabase-js';

import { promocionVigenteParaYmd } from '@/lib/facturacion/promociones';
import { filaPromocionAMotor, type PromocionRowConCombo } from '@/lib/promociones/servidor';
import { promoProductoKey, promoVarianteKey } from '@/lib/productos/variantes';
import type { Database } from '@/types/database';
import type { PromocionMotor } from '@/types/promociones';

type ComboItemRow = {
  promocion_id: string;
  producto_id: string;
  producto_variante_id: string | null;
  cantidad: number;
};

/** Mapa de promo vigente por `producto_id` (como mucho una; si hay varias en BD, gana la más reciente por `updated_at`). */
export async function cargarMapaPromocionesVigentes(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  productoIds: string[],
  fechaYmd: string,
  sucursalId?: string | null,
): Promise<Map<string, PromocionMotor>> {
  const map = new Map<string, PromocionMotor>();
  if (productoIds.length === 0) return map;

  let promoIdsPorSucursal: string[] | null = null;
  if (sucursalId) {
    const { data: accessRows, error: accessErr } = await supabase
      .from('promocion_sucursal')
      .select('promocion_id')
      .eq('tenant_id', tenantId)
      .eq('sucursal_id', sucursalId);

    if (accessErr) throw new Error(accessErr.message);

    promoIdsPorSucursal = [
      ...new Set((accessRows ?? []).map((row) => row.promocion_id).filter(Boolean)),
    ];
    if (promoIdsPorSucursal.length === 0) return map;
  }

  /** Sin embed de `promocion_combo_item`: PostgREST a veces no expone esa relación en caché; cargamos combo aparte. */
  let vinculosQuery = supabase
    .from('producto_promocion')
    .select(
      `
      producto_id,
      producto_variante_id,
      promocion (
        id,
        nombre,
        tipo,
        activa,
        cantidad_lleva,
        cantidad_paga,
        unidad_descuento,
        porcentaje,
        cantidad_minima,
        rangos_volumen,
        precio_combo,
        vigente_desde,
        vigente_hasta,
        dias_semana,
        updated_at
      )
    `,
    )
    .in('producto_id', productoIds)
    .eq('tenant_id', tenantId);
  if (promoIdsPorSucursal) {
    vinculosQuery = vinculosQuery.in('promocion_id', promoIdsPorSucursal);
  }
  const { data: vinculosPromo, error } = await vinculosQuery;

  if (error) throw new Error(error.message);

  const promoIds = new Set<string>();
  for (const row of vinculosPromo ?? []) {
    const embed = (row as { promocion?: unknown }).promocion;
    const pr = Array.isArray(embed) ? embed[0] : embed;
    if (pr && typeof pr === 'object' && pr !== null && 'id' in pr && typeof (pr as { id: unknown }).id === 'string') {
      promoIds.add((pr as { id: string }).id);
    }
  }

  const comboPorPromocion = new Map<
    string,
    { producto_id: string; producto_variante_id?: string | null; cantidad: number }[]
  >();
  if (promoIds.size > 0) {
    const { data: comboRows, error: comboErr } = await supabase
      .from('promocion_combo_item')
      .select('promocion_id, producto_id, producto_variante_id, cantidad')
      .in('promocion_id', [...promoIds])
      .eq('tenant_id', tenantId);

    if (comboErr) throw new Error(comboErr.message);

    for (const r of (comboRows ?? []) as ComboItemRow[]) {
      const arr = comboPorPromocion.get(r.promocion_id) ?? [];
      arr.push({
        producto_id: r.producto_id,
        producto_variante_id: r.producto_variante_id,
        cantidad: r.cantidad,
      });
      comboPorPromocion.set(r.promocion_id, arr);
    }
  }

  type VinculoPromoRow = {
    producto_id: string;
    producto_variante_id: string | null;
    promocion: PromocionRowConCombo | PromocionRowConCombo[] | null;
  };
  const candidatos: {
    producto_id: string;
    producto_variante_id: string | null;
    motor: PromocionMotor;
    updated: string;
  }[] = [];
  for (const row of (vinculosPromo ?? []) as VinculoPromoRow[]) {
    const embed = row.promocion;
    const pr = Array.isArray(embed) ? embed[0] : embed;
    if (!pr) continue;
    const combo = comboPorPromocion.get(pr.id) ?? null;
    const prRaw = pr as PromocionRowConCombo & { rangos_volumen?: unknown; precio_combo?: unknown };
    const prConCombo: PromocionRowConCombo = {
      ...prRaw,
      rangos_volumen: prRaw.rangos_volumen ?? null,
      precio_combo: prRaw.precio_combo ?? null,
      promocion_combo_item: combo?.length ? combo : null,
    };
    const motor = filaPromocionAMotor(prConCombo);
    if (!promocionVigenteParaYmd(motor, fechaYmd)) continue;
    candidatos.push({
      producto_id: row.producto_id,
      producto_variante_id: row.producto_variante_id ?? null,
      motor,
      updated: pr.updated_at,
    });
  }
  candidatos.sort((a, b) => (a.updated < b.updated ? 1 : -1));
  for (const c of candidatos) {
    const key = c.producto_variante_id
      ? promoVarianteKey(c.producto_id, c.producto_variante_id)
      : promoProductoKey(c.producto_id);
    if (!map.has(key)) map.set(key, c.motor);
  }
  return map;
}
