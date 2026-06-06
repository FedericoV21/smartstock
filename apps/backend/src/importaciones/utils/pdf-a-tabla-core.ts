export type PdfTextChunk = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  page: number;
};

type RowChunk = {
  y: number;
  page: number;
  chunks: PdfTextChunk[];
};

type CellChunk = {
  text: string;
  x: number;
  right: number;
};

export type PdfTablaConvertida = {
  headers: string[];
  filas: Record<string, string | number | null>[];
  totalFilas: number;
};

export function cleanPdfText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function comparableText(s: string): string {
  return cleanPdfText(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function rowTolerance(chunks: PdfTextChunk[]): number {
  const heights = chunks.map((c) => c.height).filter((n) => Number.isFinite(n) && n > 0);
  if (heights.length === 0) return 8;
  const sorted = [...heights].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 10;
  return Math.max(6, Math.min(10, median * 0.75));
}

function groupRows(chunks: PdfTextChunk[]): RowChunk[] {
  const sorted = [...chunks].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const rows: RowChunk[] = [];
  const tolerance = rowTolerance(sorted);

  for (const chunk of sorted) {
    const last = rows[rows.length - 1];
    if (last && last.page === chunk.page && Math.abs(last.y - chunk.y) <= tolerance) {
      last.chunks.push(chunk);
      last.y = (last.y + chunk.y) / 2;
    } else {
      rows.push({ page: chunk.page, y: chunk.y, chunks: [chunk] });
    }
  }

  return rows.map((row) => ({
    ...row,
    chunks: row.chunks.sort((a, b) => {
      const dx = a.x - b.x;
      if (Math.abs(dx) <= 12) return b.y - a.y || dx;
      return dx;
    }),
  }));
}

function rowToCellObjects(row: RowChunk): CellChunk[] {
  const cells: CellChunk[] = [];

  for (const chunk of row.chunks) {
    const text = cleanPdfText(chunk.text);
    if (!text) continue;
    const previous = cells[cells.length - 1];
    const gap = previous ? chunk.x - previous.right : 0;
    const isAdjacentNumericCell =
      previous != null &&
      previous.text !== '$' &&
      ((looksLikePrice(previous.text) && looksLikePrice(text)) ||
        (looksLikePrice(previous.text) && looksLikePercent(text)) ||
        (looksLikePercent(previous.text) && looksLikePrice(text)));
    const isNewCell = !previous || isAdjacentNumericCell || gap > 8;

    if (isNewCell) {
      cells.push({ text, x: chunk.x, right: chunk.x + chunk.width });
    } else {
      previous.text = `${previous.text} ${text}`;
      previous.right = Math.max(previous.right, chunk.x + chunk.width);
    }
  }

  const out: CellChunk[] = [];
  for (let i = 0; i < cells.length; i++) {
    const cur = cells[i]!;
    const next = cells[i + 1];
    if (cur.text === '$' && next) {
      out.push({
        text: next.text,
        x: cur.x,
        right: next.right,
      });
      i++;
    } else {
      out.push(cur);
    }
  }

  return out.filter((cell) => cell.text);
}

function normalizeHeader(s: string, index: number): string {
  const cleaned = cleanPdfText(s)
    .replace(/[\r\n]+/g, ' ')
    .replace(/[:;]+$/g, '')
    .trim();
  return cleaned || `Columna ${index + 1}`;
}

function uniqueHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((header, index) => {
    const base = normalizeHeader(header, index);
    const key = comparableText(base);
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    return count === 0 ? base : `${base} ${count + 1}`;
  });
}

function looksLikeExplicitHeader(cells: string[]): boolean {
  if (cells.length < 2) return false;
  const joined = comparableText(cells.join(' '));
  return /\b(cod|codigo|sku|articulo|producto|descripcion|precio|costo|lista|iva|publico|comercio)\b/.test(
    joined,
  );
}

function looksLikePrice(cell: string): boolean {
  const s = cell.trim().replace(/^\$\s*/, '');
  return /^\d{1,3}(?:[.,]\d{2,3})*(?:[.,]\d{2})?$|^\d{4,}(?:[.,]\d{2})?$/.test(s);
}

function looksLikePercent(cell: string): boolean {
  return /^-?\d{1,3}(?:[.,]\d{1,2})?\s*%$/.test(cell.trim());
}

function splitCodigoNombreFromFirstCell(first: string): { codigo: string; nombre: string } | null {
  const s = cleanPdfText(first);
  const codeOnly = /^[A-Z]{1,6}[_-]?\d{2,}[A-Z0-9_-]*$/i.exec(s);
  if (codeOnly) return { codigo: s, nombre: '' };

  const withName = /^([A-Z]{1,6}\d{2,}[A-Z0-9]*)(?:[-_\s]+)(.+)$/i.exec(s);
  if (!withName) return null;
  return { codigo: withName[1]!, nombre: cleanPdfText(withName[2]!) };
}

function rowToInferredRecord(cells: string[]): { codigo: string; nombre: string; precios: string[] } | null {
  if (cells.length < 2) return null;
  const split = splitCodigoNombreFromFirstCell(cells[0]!);
  if (!split) return null;

  const rest = cells.slice(1);
  const nombreParts = split.nombre ? [split.nombre] : [];
  const precios: string[] = [];
  let inPrices = false;

  for (const cell of rest) {
    if (cell.trim() === '$') continue;
    if (looksLikePrice(cell)) {
      inPrices = true;
      precios.push(cell.replace(/^\$\s*/, '').trim());
    } else if (inPrices) {
      nombreParts.push(cell);
    } else {
      nombreParts.push(cell);
    }
  }

  const nombre = cleanPdfText(nombreParts.join(' ')).replace(/\s+\$$/, '');
  if (!split.codigo || !nombre || precios.length === 0) return null;
  return { codigo: split.codigo, nombre, precios };
}

function rowsToInferredTable(candidateRows: string[][]): PdfTablaConvertida | null {
  const inferred = candidateRows
    .map(rowToInferredRecord)
    .filter((r): r is NonNullable<typeof r> => r != null);

  if (inferred.length < 2) return null;

  const maxPrecios = Math.max(...inferred.map((r) => r.precios.length));
  const priceHeaders =
    maxPrecios >= 3
      ? ['precio_venta_publico_iva', 'precio_costo', 'precio_comercio_con_iva']
      : maxPrecios === 2
        ? ['precio_costo', 'precio_2']
        : ['precio_costo'];
  while (priceHeaders.length < maxPrecios) {
    priceHeaders.push(`precio_${priceHeaders.length + 1}`);
  }

  const headers = ['codigo', 'nombre', ...priceHeaders];
  const filas = inferred.map((row) => {
    const out: Record<string, string | number | null> = {
      codigo: row.codigo,
      nombre: row.nombre,
    };
    for (let i = 0; i < priceHeaders.length; i++) {
      out[priceHeaders[i]!] = row.precios[i] ?? null;
    }
    return out;
  });

  return { headers, filas, totalFilas: filas.length };
}

function rowsToTable(rows: RowChunk[]): PdfTablaConvertida {
  const candidateCellRows = rows.map(rowToCellObjects).filter((cells) => cells.length >= 2);
  const candidateRows = candidateCellRows.map((cells) => cells.map((cell) => cell.text));
  if (candidateRows.length === 0) {
    throw new Error('No se detectaron filas tabulares en el PDF.');
  }

  const inferred = rowsToInferredTable(candidateRows);
  if (inferred) return inferred;

  const headerIndex = Math.max(0, candidateRows.findIndex(looksLikeExplicitHeader));
  const headerCellObjects = candidateCellRows[headerIndex] ?? candidateCellRows[0]!;
  const headerCells = headerCellObjects.map((cell) => cell.text);
  const headers = uniqueHeaders(headerCells);
  const dataRows = candidateCellRows
    .slice(headerIndex + 1)
    .filter((cells) => !looksLikeRepeatedHeaderRow(cells.map((cell) => cell.text), headers));

  const filas = dataRows.map((cells) => cellsToPositionedRow(cells, headers, headerCellObjects));

  return {
    headers,
    filas,
    totalFilas: filas.length,
  };
}

function comparableHeaderText(text: string): string {
  return comparableText(normalizeHeader(text, 0));
}

function looksLikeRepeatedHeaderRow(cells: string[], headers: string[]): boolean {
  if (cells.length < 2 || headers.length < 2) return false;
  const comparableHeaders = headers.map(comparableHeaderText);
  let matches = 0;
  for (let i = 0; i < Math.min(cells.length, comparableHeaders.length); i++) {
    if (comparableHeaderText(cells[i]!) === comparableHeaders[i]) matches++;
  }
  return matches >= Math.max(2, Math.ceil(headers.length * 0.6));
}

function nearestHeaderIndex(cell: CellChunk, headerCells: CellChunk[]): number {
  const center = (cell.x + cell.right) / 2;
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < headerCells.length; i++) {
    const header = headerCells[i]!;
    const headerCenter = (header.x + header.right) / 2;
    const distance = Math.abs(center - headerCenter);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function cellsToPositionedRow(
  cells: CellChunk[],
  headers: string[],
  headerCells: CellChunk[],
): Record<string, string | number | null> {
  const row: Record<string, string | number | null> = {};
  for (const header of headers) row[header] = null;

  if (headerCells.length !== headers.length || headerCells.length === 0) {
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]!] = cells[i]?.text ?? null;
    }
    if (cells.length > headers.length && headers.length > 0) {
      row[headers[headers.length - 1]!] = cells.slice(headers.length - 1).map((cell) => cell.text).join(' ');
    }
    return row;
  }

  for (const cell of cells) {
    const header = headers[nearestHeaderIndex(cell, headerCells)];
    if (!header) continue;
    const prev = row[header];
    row[header] = prev == null || String(prev).trim() === '' ? cell.text : `${prev} ${cell.text}`;
  }

  return row;
}

export function convertirChunksPdfATabla(chunks: PdfTextChunk[]): PdfTablaConvertida {
  if (chunks.length === 0) {
    throw new Error('El PDF no contiene texto seleccionable. Si es una imagen escaneada, hace falta OCR.');
  }

  return rowsToTable(groupRows(chunks));
}
