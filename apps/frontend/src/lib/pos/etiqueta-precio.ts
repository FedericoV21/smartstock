import { formatCurrency } from '@/lib/utils/formatters';

export type EtiquetaTamano = '50x30' | '80x40';

export type PrecioEtiquetaPartes = {
  texto: string;
  simbolo: string;
  monto: string;
};

export function precioEtiquetaPartes(precio: number | null | undefined): PrecioEtiquetaPartes {
  const texto = formatCurrency(precio ?? 0).replace(/\u00a0/g, ' ');
  const match = /^([^\d-]+)\s*(.+)$/.exec(texto);
  if (!match) {
    return { texto, simbolo: '', monto: texto };
  }
  return {
    texto,
    simbolo: match[1].trim(),
    monto: match[2].trim(),
  };
}

export function precioEtiquetaFontPx(monto: string, size: EtiquetaTamano): number {
  const chars = Math.max(4, monto.replace(/\s+/g, '').length);
  const max = size === '50x30' ? 36 : 52;
  const min = size === '50x30' ? 19 : 28;
  const widthBudget = size === '50x30' ? 86 : 138;
  const fitted = Math.floor(widthBudget / (chars * 0.55));
  return Math.max(min, Math.min(max, fitted));
}

export function precioEtiquetaTextoFontPx(texto: string, size: EtiquetaTamano): number {
  const chars = Math.max(4, texto.replace(/\s+/g, '').length);
  const max = size === '50x30' ? 22 : 30;
  const min = size === '50x30' ? 15 : 21;
  const widthBudget = size === '50x30' ? 170 : 278;
  const fitted = Math.floor(widthBudget / (chars * 0.58));
  return Math.max(min, Math.min(max, fitted));
}
