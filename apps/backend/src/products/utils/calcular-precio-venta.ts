export const GANANCIA_PCT_MAX = 999.99;
export const IVA_DEFAULT_PCT = 21;

export function redondearPrecioCentenasSuperior(
  precio: number,
  opts?: { redondearMenores100ADecenas?: boolean },
): number {
  const n = Number(precio);
  if (!Number.isFinite(n)) return n;
  if (n === 0) return 0;
  if (n < 0) return n;

  const x = Math.round(n * 100) / 100;
  if (x < 100) {
    if (opts?.redondearMenores100ADecenas) {
      const lower = Math.floor(x / 10) * 10;
      const remainderCents = Math.round(x * 100) - Math.round(lower * 100);
      const out = remainderCents > 500 ? lower + 10 : lower;
      return out === 0 ? 10 : out;
    }
    return x > 75 ? 100 : 50;
  }

  const lower = Math.floor(x / 100) * 100;
  const remainderCents = Math.round(x * 100) - Math.round(lower * 100);
  return remainderCents >= 5100 ? lower + 100 : lower;
}

export type CalcularPrecioVentaOpts = {
  redondearPreciosCentenas?: boolean;
  redondearMenores100ADecenas?: boolean;
  descuentoCostoPct?: number | null;
};

export function calcularPrecioVenta(
  precioCosto: number | null | undefined,
  porcentajeGanancia: number | null | undefined,
  ivaPorcentaje: number | null | undefined,
  ivaDefault: number = IVA_DEFAULT_PCT,
  opts?: CalcularPrecioVentaOpts,
): number {
  const costo = Number(precioCosto);
  if (!Number.isFinite(costo) || costo <= 0) return 0;

  const gananciaRaw = Number(porcentajeGanancia);
  const ganancia = Number.isFinite(gananciaRaw) ? gananciaRaw : 0;

  const ivaRaw = ivaPorcentaje == null ? NaN : Number(ivaPorcentaje);
  const iva = Number.isFinite(ivaRaw) ? ivaRaw : ivaDefault;

  const descuentoRaw = Number(opts?.descuentoCostoPct);
  const descuento = Number.isFinite(descuentoRaw)
    ? Math.min(100, Math.max(0, descuentoRaw))
    : 0;
  const costoBase = costo * (1 - descuento / 100);
  const precio = costoBase * (1 + ganancia / 100) * (1 + iva / 100);
  let out = Math.ceil(precio * 100) / 100;
  if (opts?.redondearPreciosCentenas) {
    out = redondearPrecioCentenasSuperior(out, {
      redondearMenores100ADecenas: opts.redondearMenores100ADecenas,
    });
  }
  return out;
}

export type CostoDesdePvpOpts = {
  descuentoCostoPct?: number | null;
};

/** Inverso de calcularPrecioVenta: deriva costo desde PVP con IVA y ganancia. */
export function costoDesdePvpConIvaYGanancia(
  precioVentaConIva: number,
  ivaPorcentaje: number | null | undefined,
  ivaDefault: number = IVA_DEFAULT_PCT,
  porcentajeGanancia: number | null | undefined = 0,
  opts?: CostoDesdePvpOpts,
): number {
  const venta = Number(precioVentaConIva);
  if (!Number.isFinite(venta) || venta <= 0) return 0;

  const gananciaRaw = Number(porcentajeGanancia);
  const ganancia = Number.isFinite(gananciaRaw) ? gananciaRaw : 0;
  if (ganancia <= -100) return 0;

  const ivaRaw = ivaPorcentaje == null ? NaN : Number(ivaPorcentaje);
  const iva = Number.isFinite(ivaRaw) ? ivaRaw : ivaDefault;
  const divisorIva = 1 + iva / 100;
  const divisorGanancia = 1 + ganancia / 100;
  if (!(divisorIva > 0) || !(divisorGanancia > 0)) return 0;

  const descuentoRaw = Number(opts?.descuentoCostoPct);
  const descuento = Number.isFinite(descuentoRaw)
    ? Math.min(100, Math.max(0, descuentoRaw))
    : 0;
  const factorDescuento = 1 - descuento / 100;
  if (!(factorDescuento > 0)) return 0;

  const costoBase = venta / divisorIva / divisorGanancia;
  return Math.round((costoBase / factorDescuento) * 100) / 100;
}

export function margenGananciaSobreCostoSinIva(
  precioCosto: number | null | undefined,
  precioVenta: number | null | undefined,
  ivaPorcentaje: number | null | undefined,
  ivaDefault: number = IVA_DEFAULT_PCT,
): number | null {
  const costo = Number(precioCosto);
  if (!Number.isFinite(costo) || costo <= 0) return null;
  const venta = Number(precioVenta);
  if (!Number.isFinite(venta)) return null;

  const ivaRaw = ivaPorcentaje != null ? Number(ivaPorcentaje) : NaN;
  const iva = Number.isFinite(ivaRaw) ? ivaRaw : ivaDefault;
  const divisor = 1 + iva / 100;
  if (!(divisor > 0)) return null;

  const neto = venta / divisor;
  const pct = ((neto - costo) / costo) * 100;
  return Math.round(pct * 10) / 10;
}
