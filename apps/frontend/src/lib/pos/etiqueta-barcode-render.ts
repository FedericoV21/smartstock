import { validarEAN13, validarEAN8 } from '@/lib/pos/ean13';

export type EtiquetaBwipOpts = {
  bcid: 'ean8' | 'ean13' | 'code128';
  text: string;
  scale: number;
  height: number;
};

/**
 * Opciones para bwip-js en etiquetas: EAN si es válido, si no Code 128 (cualquier texto asignable).
 */
export function opcionesBwipEtiqueta(
  codigo: string,
  sizeMm: '50x30' | '80x40' = '50x30',
): EtiquetaBwipOpts | null {
  const trimmed = codigo.trim();
  if (!trimmed) return null;

  if (validarEAN8(trimmed)) {
    return { bcid: 'ean8', text: trimmed, scale: 1.75, height: 8 };
  }
  if (validarEAN13(trimmed)) {
    return { bcid: 'ean13', text: trimmed, scale: 1.75, height: 8 };
  }

  const len = trimmed.length;
  const isSmall = sizeMm === '50x30';
  const scale =
    len > 12 ? 1 : len > 8 ? (isSmall ? 1 : 2) : len > 6 ? (isSmall ? 1 : 2) : 2;

  return {
    bcid: 'code128',
    text: trimmed,
    scale:
      scale >= 2
        ? Math.max(1.25, scale - 0.25)
        : scale,
    /** Texto legible fuera del bitmap; barras un poco más altas para compensar. */
    height: 8,
  };
}
