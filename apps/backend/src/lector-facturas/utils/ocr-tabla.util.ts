import { join } from 'node:path';

import sharp from 'sharp';
import { createWorker } from 'tesseract.js';

type OcrWord = {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  conf: number;
  lineKey: string;
};

type OcrLine = {
  text: string;
  words: OcrWord[];
  left: number;
  top: number;
  width: number;
  height: number;
  conf: number;
};

export type FacturaTablaOcrItem = {
  indice: number;
  codigo: string | null;
  descripcion: string;
  cantidad: number | null;
  unidad: string | null;
  precio_unitario: number | null;
  subtotal: number | null;
  columnas: Record<string, string | number | null>;
  confianza: number;
  fuente: 'cantidad_primero' | 'codigo_primero';
  advertencias: string[];
};

export type FacturaTablaOcrResultado = {
  metodo: 'ocr_tabla';
  items: FacturaTablaOcrItem[];
  lineas: string[];
  raw_text: string;
  advertencias: string[];
  validacion: {
    suma_items: number;
    items_con_diferencia: number;
    items_cuadran: boolean;
  };
  meta: {
    archivo_nombre: string;
    mime_type: string;
    confianza_ocr: number;
    filas_detectadas: number;
  };
};

const FOOTER_RE = /\b(subtotal|imp\.?\s*neto|importe\s*total|total:|cae|afip|perc\.?|alias)\b/i;
const HEADER_RE =
  /\b(cant|cantidad|producto|servicio|c[oó]digo|descripcion|descrip|unitario|importe|precio|total)\b/i;
const MONEY_CHARS_RE = /[$\s]/g;
const TOLERANCIA_ITEM = 1.05;

function cleanText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function tokenLimpio(s: string): string {
  return s
    .trim()
    .replace(/^[|"'`´“”]+|[|"'`´“”]+$/g, '')
    .replace(/[;:]+$/g, '');
}

function promedio(nums: number[]): number {
  const validos = nums.filter((n) => Number.isFinite(n));
  if (validos.length === 0) return 0;
  return Math.round(validos.reduce((a, b) => a + b, 0) / validos.length);
}

function parseCantidadToken(token: string): number | null {
  const t = tokenLimpio(token).replace(/^[^\d-]+/, '').replace(/[^\d,.-]+$/g, '');
  const m = /^-?\d{1,4}(?:[,.]\d+)?$/.exec(t);
  if (!m) return null;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function esCodigoToken(token: string): boolean {
  return /^\d{1,6}$/.test(tokenLimpio(token));
}

function parseMontoFactura(token: string): number | null {
  let s = tokenLimpio(token)
    .replace(MONEY_CHARS_RE, '')
    .replace(/[^\d,.-]/g, '');
  if (!s || s === '-' || s === '.' || s === ',') return null;

  const negativo = s.startsWith('-');
  s = s.replace(/^-/, '');

  let normalizado: string;
  if (s.includes(',')) {
    normalizado = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes('.')) {
    const lastDot = s.lastIndexOf('.');
    const entero = s.slice(0, lastDot).replace(/\./g, '');
    const dec = s.slice(lastDot + 1);
    if (dec.length === 2) {
      normalizado = `${entero || '0'}.${dec}`;
    } else if (dec.length > 2) {
      const digits = `${entero}${dec}`.replace(/\D/g, '');
      normalizado = digits.length >= 4 ? `${digits.slice(0, -2)}.${digits.slice(-2)}` : digits;
    } else {
      normalizado = `${entero}.${dec}`;
    }
  } else if (/^\d{4,}$/.test(s)) {
    normalizado = `${s.slice(0, -2)}.${s.slice(-2)}`;
  } else {
    normalizado = s;
  }

  const n = Number(normalizado);
  if (!Number.isFinite(n)) return null;
  return negativo ? -n : n;
}

function esMontoToken(token: string): boolean {
  const limpio = tokenLimpio(token).replace(MONEY_CHARS_RE, '');
  if (!limpio) return false;
  if (/[,.]/.test(limpio)) return parseMontoFactura(limpio) != null;
  return /^\d{4,}$/.test(limpio);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function advertenciasItem(item: {
  cantidad: number | null;
  precio_unitario: number | null;
  subtotal: number | null;
}): string[] {
  if (item.cantidad == null || item.precio_unitario == null || item.subtotal == null) return [];
  const esperado = round2(item.cantidad * item.precio_unitario);
  const diff = Math.abs(esperado - item.subtotal);
  if (diff <= TOLERANCIA_ITEM) return [];
  return [`Cantidad x unitario da ${esperado}, pero el importe leido es ${item.subtotal}.`];
}

function parseTsv(tsv: string): { words: OcrWord[]; lines: OcrLine[] } {
  const words: OcrWord[] = [];
  const rows = tsv.split(/\r?\n/);

  for (const row of rows) {
    if (!row.trim()) continue;
    const parts = row.split('\t');
    if (parts.length < 12) continue;
    const level = Number(parts[0]);
    if (level !== 5) continue;

    const text = tokenLimpio(parts.slice(11).join('\t'));
    if (!text) continue;

    const left = Number(parts[6]);
    const top = Number(parts[7]);
    const width = Number(parts[8]);
    const height = Number(parts[9]);
    const conf = Number(parts[10]);
    if (![left, top, width, height, conf].every(Number.isFinite)) continue;
    if (conf < 15 && !/\d/.test(text)) continue;

    words.push({
      text,
      left,
      top,
      width,
      height,
      conf,
      lineKey: parts.slice(1, 5).join(':'),
    });
  }

  const byLine = new Map<string, OcrWord[]>();
  for (const word of words) {
    const bucket = byLine.get(word.lineKey) ?? [];
    bucket.push(word);
    byLine.set(word.lineKey, bucket);
  }

  const lines = [...byLine.values()]
    .map((lineWords) => {
      const sorted = lineWords.sort((a, b) => a.left - b.left);
      const left = Math.min(...sorted.map((w) => w.left));
      const right = Math.max(...sorted.map((w) => w.left + w.width));
      const top = Math.min(...sorted.map((w) => w.top));
      const bottom = Math.max(...sorted.map((w) => w.top + w.height));
      return {
        text: cleanText(sorted.map((w) => w.text).join(' ')),
        words: sorted,
        left,
        top,
        width: right - left,
        height: bottom - top,
        conf: promedio(sorted.map((w) => w.conf)),
      };
    })
    .filter((line) => line.text)
    .sort((a, b) => a.top - b.top || a.left - b.left);

  return { words, lines };
}

function tokensDeLinea(line: OcrLine): string[] {
  return line.text.split(/\s+/).map(tokenLimpio).filter(Boolean);
}

function parseCantidadPrimero(lines: OcrLine[]): FacturaTablaOcrItem[] {
  const items: FacturaTablaOcrItem[] = [];

  for (const line of lines) {
    if (FOOTER_RE.test(line.text) || HEADER_RE.test(line.text)) continue;
    const tokens = tokensDeLinea(line);
    if (tokens.length < 5) continue;

    const cantidad = parseCantidadToken(tokens[0] ?? '');
    if (cantidad == null || cantidad <= 0 || cantidad > 999) continue;

    const moneyIndexes = tokens
      .map((token, index) => ({ token, index }))
      .filter(({ token }) => esMontoToken(token));
    if (moneyIndexes.length < 2) continue;

    const subtotalIdx = moneyIndexes[moneyIndexes.length - 1]!.index;
    const precioIdx = moneyIndexes[moneyIndexes.length - 2]!.index;
    let codigoIdx = -1;
    for (let i = precioIdx - 1; i >= 1; i--) {
      if (esCodigoToken(tokens[i]!)) {
        codigoIdx = i;
        break;
      }
    }
    if (codigoIdx < 0) continue;

    const descripcion = cleanText(tokens.slice(1, codigoIdx).join(' '));
    if (!descripcion || descripcion.length < 3) continue;

    const precioUnitario = parseMontoFactura(tokens[precioIdx]!);
    const subtotal = parseMontoFactura(tokens[subtotalIdx]!);
    const itemBase = {
      cantidad,
      precio_unitario: precioUnitario,
      subtotal,
    };

    items.push({
      indice: items.length,
      codigo: tokens[codigoIdx]!,
      descripcion,
      cantidad,
      unidad: null,
      precio_unitario: precioUnitario,
      subtotal,
      columnas: {
        cantidad,
        descripcion,
        codigo: tokens[codigoIdx]!,
        precio_unitario: precioUnitario,
        importe: subtotal,
      },
      confianza: line.conf,
      fuente: 'cantidad_primero',
      advertencias: advertenciasItem(itemBase),
    });
  }

  return items;
}

function primeraPalabraCodigo(line: OcrLine, pageWidth: number): OcrWord | null {
  const candidatas = line.words.slice(0, 4);
  for (const word of candidatas) {
    if (word.left > pageWidth * 0.24) continue;
    if (esCodigoToken(word.text) && word.text.length >= 3) return word;
  }
  return null;
}

function parseCodigoPrimero(lines: OcrLine[], pageWidth: number, pageHeight: number): FacturaTablaOcrItem[] {
  const rows: OcrLine[][] = [];
  let actual: OcrLine[] | null = null;

  for (const line of lines) {
    if (line.top < pageHeight * 0.16) continue;
    if (FOOTER_RE.test(line.text)) {
      if (actual) rows.push(actual);
      actual = null;
      break;
    }

    const start = primeraPalabraCodigo(line, pageWidth);
    if (start) {
      if (actual) rows.push(actual);
      actual = [line];
    } else if (actual && line.top - actual[actual.length - 1]!.top < 85 && !HEADER_RE.test(line.text)) {
      actual.push(line);
    }
  }
  if (actual) rows.push(actual);

  const items: FacturaTablaOcrItem[] = [];
  const w = Math.max(pageWidth, 1);

  for (const row of rows) {
    const words = row.flatMap((line) => line.words).sort((a, b) => a.top - b.top || a.left - b.left);
    const codeWord = words.find((word) => esCodigoToken(word.text) && word.left < w * 0.24);
    if (!codeWord) continue;

    const descWords = words
      .filter((word) => {
        if (word === codeWord) return false;
        if (word.left < codeWord.left + codeWord.width) return false;
        if (word.left >= w * 0.44) return false;
        if (esMontoToken(word.text)) return false;
        if (/^\d{1,2}[,.]\d{1,2}%$/.test(word.text)) return false;
        return word.conf >= 20 || /[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(word.text);
      })
      .sort((a, b) => a.top - b.top || a.left - b.left);

    const descripcion = cleanText(descWords.map((word) => word.text).join(' '));
    if (!descripcion || descripcion.length < 3) continue;

    const cantidadWord =
      words.find((word) => word.left >= w * 0.35 && word.left < w * 0.45 && parseCantidadToken(word.text) != null) ??
      null;
    const uxbWord =
      words.find((word) => word.left >= w * 0.42 && word.left < w * 0.51 && /^x?\d+$/i.test(tokenLimpio(word.text))) ??
      null;
    const undWord =
      words.find((word) => word.left >= w * 0.48 && word.left < w * 0.56 && parseCantidadToken(word.text) != null) ??
      null;

    const precioCandidates = words
      .filter((word) => word.left >= w * 0.50 && word.left < w * 0.70 && esMontoToken(word.text))
      .map((word) => ({ word, monto: parseMontoFactura(word.text) }))
      .filter((x): x is { word: OcrWord; monto: number } => x.monto != null && x.monto > 0);
    const totalCandidates = words
      .filter((word) => word.left >= w * 0.78 && esMontoToken(word.text))
      .map((word) => ({ word, monto: parseMontoFactura(word.text) }))
      .filter((x): x is { word: OcrWord; monto: number } => x.monto != null && x.monto > 0);

    const fallbackMoneys = words
      .filter((word) => esMontoToken(word.text))
      .map((word) => ({ word, monto: parseMontoFactura(word.text) }))
      .filter((x): x is { word: OcrWord; monto: number } => x.monto != null && x.monto > 0);

    const precioUnitario =
      precioCandidates[0]?.monto ?? (fallbackMoneys.length >= 2 ? fallbackMoneys[fallbackMoneys.length - 2]!.monto : null);
    const subtotal =
      totalCandidates[totalCandidates.length - 1]?.monto ?? fallbackMoneys[fallbackMoneys.length - 1]?.monto ?? null;
    const cantidad = cantidadWord ? parseCantidadToken(cantidadWord.text) : null;
    const itemBase = {
      cantidad,
      precio_unitario: precioUnitario,
      subtotal,
    };

    items.push({
      indice: items.length,
      codigo: codeWord.text,
      descripcion,
      cantidad,
      unidad: uxbWord?.text ?? null,
      precio_unitario: precioUnitario,
      subtotal,
      columnas: {
        codigo: codeWord.text,
        descripcion,
        bult: cantidad,
        uxb: uxbWord?.text ?? null,
        und: undWord ? parseCantidadToken(undWord.text) : null,
        precio: precioUnitario,
        total: subtotal,
      },
      confianza: promedio(words.map((word) => word.conf)),
      fuente: 'codigo_primero',
      advertencias: advertenciasItem(itemBase),
    });
  }

  return items;
}

function elegirItems(lines: OcrLine[], pageWidth: number, pageHeight: number): FacturaTablaOcrItem[] {
  const cantidadPrimero = parseCantidadPrimero(lines);
  const codigoPrimero = parseCodigoPrimero(lines, pageWidth, pageHeight);
  const buenosCantidad = cantidadPrimero.filter((item) => item.advertencias.length === 0).length;
  const buenosCodigo = codigoPrimero.filter((item) => item.advertencias.length === 0).length;

  if (cantidadPrimero.length >= 3 && buenosCantidad >= buenosCodigo) return cantidadPrimero;
  if (codigoPrimero.length > 0) return codigoPrimero;
  return cantidadPrimero;
}

function validarItems(items: FacturaTablaOcrItem[]): FacturaTablaOcrResultado['validacion'] {
  const suma = round2(items.reduce((acc, item) => acc + (item.subtotal ?? 0), 0));
  const itemsConDiferencia = items.filter((item) => item.advertencias.length > 0).length;
  return {
    suma_items: suma,
    items_con_diferencia: itemsConDiferencia,
    items_cuadran: items.length > 0 && itemsConDiferencia === 0,
  };
}

export function parsearTablaFacturaDesdeTsv(params: {
  tsv: string;
  rawText: string;
  archivoNombre: string;
  mimeType: string;
  confianzaOcr: number;
}): FacturaTablaOcrResultado {
  const { words, lines } = parseTsv(params.tsv);
  const pageWidth = Math.max(...words.map((word) => word.left + word.width), 1);
  const pageHeight = Math.max(...words.map((word) => word.top + word.height), 1);
  const items = elegirItems(lines, pageWidth, pageHeight).map((item, indice) => ({ ...item, indice }));
  const validacion = validarItems(items);
  const advertencias: string[] = [];

  if (items.length === 0) {
    advertencias.push('No se detectaron filas de productos con el parser OCR.');
  }
  if (validacion.items_con_diferencia > 0) {
    advertencias.push('Hay filas donde cantidad x precio no coincide con el importe leido.');
  }
  if (items.some((item) => item.confianza < 55)) {
    advertencias.push('Algunas filas tienen baja confianza OCR; conviene revisar la foto o editar a mano.');
  }

  return {
    metodo: 'ocr_tabla',
    items,
    lineas: lines.map((line) => line.text),
    raw_text: params.rawText,
    advertencias,
    validacion,
    meta: {
      archivo_nombre: params.archivoNombre,
      mime_type: params.mimeType,
      confianza_ocr: Math.round(params.confianzaOcr),
      filas_detectadas: items.length,
    },
  };
}

async function prepararImagenParaOcr(bytes: Uint8Array): Promise<Buffer> {
  const meta = await sharp(bytes).rotate().metadata();
  const targetWidth = meta.width && meta.width < 1700 ? 1800 : undefined;

  return sharp(bytes)
    .rotate()
    .resize(targetWidth ? { width: targetWidth, withoutEnlargement: false } : undefined)
    .grayscale()
    .normalize()
    .sharpen()
    .png()
    .toBuffer();
}

export async function extraerTablaFacturaConOcr(params: {
  bytes: Uint8Array;
  mimeType: string;
  archivoNombre: string;
}): Promise<FacturaTablaOcrResultado> {
  const langPath = join(
    process.cwd(),
    'node_modules',
    '@tesseract.js-data',
    'spa',
    '4.0.0_best_int',
  );
  const image = await prepararImagenParaOcr(params.bytes);
  const worker = await createWorker('spa', 1, {
    langPath,
    cacheMethod: 'none',
  });

  try {
    await worker.setParameters({
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    });
    const { data } = await worker.recognize(image, {}, { text: true, tsv: true });
    return parsearTablaFacturaDesdeTsv({
      tsv: data.tsv ?? '',
      rawText: data.text ?? '',
      archivoNombre: params.archivoNombre,
      mimeType: params.mimeType,
      confianzaOcr: data.confidence ?? 0,
    });
  } finally {
    await worker.terminate();
  }
}
