export function parsearPorcentajeLista(valor: unknown): number | null {
  if (valor == null || String(valor).trim() === '') return null;
  if (typeof valor === 'number' && Number.isFinite(valor)) {
    return Math.round(valor * 100) / 100;
  }
  const s = String(valor).trim().replace(/%/g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}
