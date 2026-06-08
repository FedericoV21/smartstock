export type TramoInput = { cantidad_desde: number; ganancia_pct: number };

function toNum(v: unknown): number {
  const n =
    typeof v === 'string' && v.trim() !== '' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : NaN;
}

export function validarTramos(
  raw: unknown,
): { ok: true; tramos: TramoInput[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: 'tramos debe ser un array' };
  const out: TramoInput[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      return { ok: false, error: 'tramo inválido' };
    }
    const obj = r as Record<string, unknown>;
    const cantidad_desde = toNum(obj.cantidad_desde);
    const ganancia_pct = toNum(obj.ganancia_pct);
    if (!(cantidad_desde >= 1)) {
      return { ok: false, error: 'cantidad_desde debe ser >= 1' };
    }
    if (!(ganancia_pct >= 0)) {
      return { ok: false, error: 'ganancia_pct debe ser >= 0' };
    }
    out.push({
      cantidad_desde: Math.round(cantidad_desde * 1000) / 1000,
      ganancia_pct: Math.round(ganancia_pct * 100) / 100,
    });
  }

  const last = new Map<number, TramoInput>();
  for (const t of out) {
    last.set(t.cantidad_desde, t);
  }
  const seenKeys = new Set<number>();
  const keyOrder: number[] = [];
  for (const t of out) {
    if (seenKeys.has(t.cantidad_desde)) continue;
    seenKeys.add(t.cantidad_desde);
    keyOrder.push(t.cantidad_desde);
  }
  const dedup = keyOrder.map((k) => last.get(k)!);
  return { ok: true, tramos: dedup };
}
