/** Parseo de montos con separadores AR/US habituales en listas de precios. */
export function parsearPrecioArgentino(valor: unknown): number | null {
  if (valor == null || String(valor).trim() === '') return null;

  let s = String(valor).trim().replace(/[^\d.,\-]/g, '');
  if (s === '' || s === '-') return null;

  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  s = s.replace(/-/g, '');
  if (s === '') return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');

  let normalized: string;

  if (lastComma >= 0 && lastDot >= 0) {
    if (lastDot > lastComma) {
      normalized = s.replace(/,/g, '');
    } else {
      normalized = s.replace(/\./g, '').replace(',', '.');
    }
  } else if (lastComma >= 0) {
    const after = s.slice(lastComma + 1);
    if (/^\d{1,2}$/.test(after)) {
      normalized = s.slice(0, lastComma).replace(/\./g, '') + '.' + after;
    } else if (/^\d{3}$/.test(after)) {
      normalized = s.replace(/,/g, '');
    } else {
      const parts = s.split(',');
      if (parts.length > 1 && parts.every((p) => /^\d+$/.test(p))) {
        normalized = parts.join('');
      } else {
        normalized = s.slice(0, lastComma).replace(/\./g, '') + '.' + after;
      }
    }
  } else if (lastDot >= 0) {
    const parts = s.split('.');
    if (!parts.every((p) => /^\d+$/.test(p)) || parts.length < 2) {
      normalized = s;
    } else {
      const last = parts[parts.length - 1]!;
      if (last.length <= 2) {
        normalized = parts.slice(0, -1).join('') + '.' + last;
      } else {
        normalized = parts.join('');
      }
    }
  } else {
    normalized = s;
  }

  const num = parseFloat(normalized);
  if (Number.isNaN(num)) return null;
  const rounded = Math.round(num * 100) / 100;
  return neg ? -rounded : rounded;
}
