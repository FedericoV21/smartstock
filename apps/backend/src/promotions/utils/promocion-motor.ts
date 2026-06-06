import { Promocion } from '../entities/promocion.entity';
import { PromocionTipo, PROMOCION_TIPOS } from '../enums/promocion-tipo.enum';
import type { PromocionMotor, RangoVolumen } from '../types/promocion-motor.types';

const MIN_CANTIDAD_COMBO = 1e-5;

function parseRangosVolumenDb(raw: unknown): RangoVolumen[] | null {
  if (raw == null) return null;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: RangoVolumen[] = [];
  for (const row of raw) {
    if (row == null || typeof row !== 'object') return null;
    const o = row as Record<string, unknown>;
    const desde = Number(o.cantidad_desde);
    const hasta = o.cantidad_hasta == null ? null : Number(o.cantidad_hasta);
    const pct = Number(o.porcentaje);
    if (!Number.isFinite(desde) || !Number.isInteger(desde) || desde < 1) return null;
    if (hasta != null && (!Number.isInteger(hasta) || hasta < desde)) return null;
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return null;
    out.push({
      cantidad_desde: desde,
      cantidad_hasta: hasta,
      porcentaje: Math.round(pct * 100) / 100,
    });
  }
  return out.length ? out : null;
}

function parseComboItemsEmbed(
  embed: unknown,
): { producto_id: string; producto_variante_id?: string | null; cantidad: number }[] | null {
  if (!Array.isArray(embed) || embed.length === 0) return null;
  const out: { producto_id: string; producto_variante_id?: string | null; cantidad: number }[] = [];
  for (const row of embed) {
    if (row == null || typeof row !== 'object') return null;
    const o = row as Record<string, unknown>;
    const pid = String(o.producto_id ?? '').trim();
    const varianteId =
      typeof o.producto_variante_id === 'string' && o.producto_variante_id.trim()
        ? o.producto_variante_id.trim()
        : null;
    const c = Number(o.cantidad);
    if (!pid.length || !Number.isFinite(c) || c < MIN_CANTIDAD_COMBO) return null;
    out.push({ producto_id: pid, producto_variante_id: varianteId, cantidad: c });
  }
  return out;
}

export function esPromocionTipo(v: string): v is PromocionTipo {
  return (PROMOCION_TIPOS as string[]).includes(v);
}

export function filaPromocionAMotor(
  row: Promocion & {
    promocion_combo_item?: {
      producto_id: string;
      producto_variante_id?: string | null;
      cantidad: number | string;
    }[] | null;
  },
): PromocionMotor {
  const comboEmbed = row.promocion_combo_item?.map((ci) => ({
    producto_id: ci.producto_id,
    producto_variante_id: ci.producto_variante_id ?? null,
    cantidad: Number(ci.cantidad),
  }));
  return {
    id: row.id,
    nombre: row.nombre,
    tipo: row.tipo,
    cantidad_lleva: row.cantidadLleva,
    cantidad_paga: row.cantidadPaga,
    unidad_descuento: row.unidadDescuento,
    porcentaje: row.porcentaje != null ? Number(row.porcentaje) : null,
    cantidad_minima: row.cantidadMinima,
    rangos_volumen: parseRangosVolumenDb(row.rangosVolumen),
    precio_combo: row.precioCombo != null ? Number(row.precioCombo) : null,
    combo_items: parseComboItemsEmbed(comboEmbed),
    vigente_desde: row.vigenteDesde,
    vigente_hasta: row.vigenteHasta,
    dias_semana: row.diasSemana,
    activa: row.activa,
  };
}

export function promoVisibleEnSucursal(
  promoSucursalId: string | null | undefined,
  accessSucursalIds: string[],
  currentSucursalId: string,
): boolean {
  return promoSucursalId === currentSucursalId || accessSucursalIds.includes(currentSucursalId);
}
