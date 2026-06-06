export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function clampDescuentoPct(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n >= 99.99) return 99.99;
  return round2(n);
}

export function costoNetoDesdeLista(costoExtraido: number, descuentoPct: number): number {
  const d = clampDescuentoPct(descuentoPct);
  const raw = Number(costoExtraido);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return round2(raw * (1 - d / 100));
}

export function variacionPct(anterior: number, nuevo: number): number {
  if (anterior <= 0) return nuevo > 0 ? 100 : 0;
  return round2(((nuevo - anterior) / anterior) * 100);
}

export function margenPct(costo: number, venta: number): number {
  if (costo <= 0 || venta <= 0) return 0;
  return round2(((venta - costo) / costo) * 100);
}

export function sugerirPrecioVentaCliente(
  nuevoCosto: number,
  costoAnterior: number | null,
  ventaActual: number | null,
): number {
  const c0 = costoAnterior ?? 0;
  const v0 = ventaActual ?? 0;
  if (c0 > 0 && v0 > 0) {
    const margenActual = ((v0 - c0) / c0) * 100;
    if (margenActual > 0) {
      return round2(nuevoCosto * (1 + margenActual / 100));
    }
  }
  return round2(nuevoCosto * 1.3);
}
