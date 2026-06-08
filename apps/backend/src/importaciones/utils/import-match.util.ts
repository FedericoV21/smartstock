import { UnidadMedida } from '../../products/enums/unidad-medida.enum';

export function claveProductoMatchCodigoUnidad(codigo: string, unidad: UnidadMedida): string {
  return `${codigo.trim().toLowerCase()}\0${unidad}`;
}

export function normalizarCodigoMatch(codigo: string | null | undefined): string {
  return (codigo ?? '').trim().toLowerCase();
}

export function normalizarBarcodeMatch(barcode: string | null | undefined): string | null {
  const v = (barcode ?? '').trim();
  return v ? v.toLowerCase() : null;
}

export function esMatchEstrictoCodigoBarcode(
  a: { codigo: string | null | undefined; codigo_barras: string | null | undefined },
  b: { codigo: string | null | undefined; codigo_barras: string | null | undefined },
): boolean {
  const ca = normalizarCodigoMatch(a.codigo);
  const cb = normalizarCodigoMatch(b.codigo);
  if (!ca || !cb || ca !== cb) return false;
  const ba = normalizarBarcodeMatch(a.codigo_barras);
  const bb = normalizarBarcodeMatch(b.codigo_barras);
  if (!ba || !bb) return false;
  return ba === bb;
}

export function chunkStrings(items: string[], size: number): string[][] {
  if (items.length <= size) return items.length === 0 ? [] : [items];
  const out: string[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
