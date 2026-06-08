export const IVA_PRODUCTO_DEFAULT_SELECT_VALUE = '__default__';

export const IVA_PRODUCTO_ALICUOTAS = [27, 21, 10.5, 0] as const;

export type IvaProductoAlicuota = (typeof IVA_PRODUCTO_ALICUOTAS)[number];

export const IVA_PRODUCTO_OPCIONES = IVA_PRODUCTO_ALICUOTAS.map((value) => ({
  value,
  selectValue: String(value),
  label: etiquetaIvaProducto(value),
}));

export function etiquetaIvaProducto(value: number): string {
  if (valorNumericoEq(value, 0)) return '0% / Exento';
  if (valorNumericoEq(value, 10.5)) return '10,5%';
  return `${formatNumeroIva(value)}%`;
}

export function normalizarIvaProductoValor(value: unknown): IvaProductoAlicuota | null {
  const n = numeroDesdeIva(value);
  if (n == null) return null;
  return IVA_PRODUCTO_ALICUOTAS.find((allowed) => valorNumericoEq(allowed, n)) ?? null;
}

export function esIvaProductoPermitido(value: unknown): boolean {
  return normalizarIvaProductoValor(value) != null;
}

function numeroDesdeIva(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  }
  const s = String(value).trim();
  if (!s) return null;
  const cleaned = s.replace('%', '').replace(',', '.');
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function valorNumericoEq(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.001;
}

function formatNumeroIva(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value).replace('.', ',');
}
