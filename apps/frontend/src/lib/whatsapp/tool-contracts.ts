export type ToolContractResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function normalizeSafe(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function validateEntityTargetName(
  value: unknown,
  label: 'proveedor' | 'cliente' | 'producto',
): ToolContractResult<string> {
  if (typeof value !== 'string') {
    return { ok: false, error: `Falta ${label} para ejecutar la consulta.` };
  }
  const clean = value.trim().replace(/[?.!,:;]+$/g, '');
  if (!clean) {
    return { ok: false, error: `Falta ${label} para ejecutar la consulta.` };
  }
  if (clean.length < 2) {
    return { ok: false, error: `El nombre de ${label} es demasiado corto.` };
  }
  if (clean.length > 120) {
    return { ok: false, error: `El nombre de ${label} es demasiado largo.` };
  }
  return { ok: true, value: clean };
}

export function validatePositiveAmount(value: unknown): ToolContractResult<number> {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, error: 'El monto debe ser un número mayor a cero.' };
  }
  return { ok: true, value: Math.round(n * 100) / 100 };
}

export function validateStockAdjustmentQuantity(value: unknown): ToolContractResult<number> {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) {
    return { ok: false, error: 'La cantidad del ajuste no puede ser cero.' };
  }
  return { ok: true, value: Math.round(n * 1000) / 1000 };
}

export function validateReportPage(raw: string): number {
  const m = raw.match(/(?:pagina|página)\s*(\d{1,3})/i);
  if (!m) return 1;
  const page = Number(m[1]);
  if (!Number.isFinite(page)) return 1;
  return Math.max(1, Math.min(999, Math.trunc(page)));
}
