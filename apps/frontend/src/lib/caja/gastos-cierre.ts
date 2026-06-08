import { redondear2 } from '@/lib/caja/cierre-z-calculo';

export type GastoCierreItem = { concepto: string; monto: number };

export type GastoLineaBorrador = { id: string; monto: number | null; concepto: string };

const MAX_LINEAS = 25;

function montoPositivoRedondeado(m: number | null): number {
  if (m == null || !Number.isFinite(m) || m <= 0) return 0;
  return redondear2(m);
}

export function nuevaLineaGasto(): GastoLineaBorrador {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `g-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return { id, monto: null, concepto: '' };
}

/**
 * Convierte filas del formulario en ítems persistibles.
 * Filas vacías se ignoran. Fila incompleta (solo monto o solo concepto) devuelve error.
 */
export function compactarGastosDesdeBorrador(
  lineas: GastoLineaBorrador[],
): { ok: true; items: GastoCierreItem[]; total: number } | { ok: false; error: string } {
  const items: GastoCierreItem[] = [];
  for (const L of lineas) {
    const c = L.concepto.trim();
    const m = montoPositivoRedondeado(L.monto);
    if (!c && m <= 0) continue;
    if (c && m <= 0) {
      return { ok: false, error: 'Cada gasto con concepto necesita un monto mayor a 0.' };
    }
    if (!c && m > 0) {
      return { ok: false, error: 'Indicá de qué es cada gasto (concepto).' };
    }
    if (c && m > 0) {
      items.push({ concepto: c.slice(0, 200), monto: m });
    }
  }
  if (items.length > MAX_LINEAS) {
    return { ok: false, error: `Máximo ${MAX_LINEAS} gastos por cierre.` };
  }
  const total = items.length ? redondear2(items.reduce((s, x) => s + x.monto, 0)) : 0;
  return { ok: true, items, total };
}

/** Normaliza el array enviado por el cliente: cada ítem válido tiene concepto no vacío y monto > 0. */
export function parseGastosItemsCierre(raw: unknown): { items: GastoCierreItem[]; total: number } {
  if (!Array.isArray(raw)) return { items: [], total: 0 };
  const items: GastoCierreItem[] = [];
  for (const row of raw.slice(0, MAX_LINEAS)) {
    if (!row || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    const concepto = String(o.concepto ?? '').trim();
    const monto = Number(o.monto);
    if (!concepto || !Number.isFinite(monto) || monto <= 0) continue;
    items.push({ concepto: concepto.slice(0, 200), monto: redondear2(monto) });
  }
  const total = items.length ? redondear2(items.reduce((s, x) => s + x.monto, 0)) : 0;
  return { items, total };
}
