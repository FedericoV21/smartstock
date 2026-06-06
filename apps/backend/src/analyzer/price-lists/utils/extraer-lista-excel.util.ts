import * as XLSX from 'xlsx';

import { normalizarString } from './lista-matching.util';
import { parsearPrecioArgentino } from './parsear-precio-argentino.util';
import type { ItemExtraidoLista } from '../types/item-extraido-lista.type';

const HEADER_ALIASES_PRECIO = [
  'precio', 'pvp', 'precio_venta', 'pventa', 'precio_unitario', 'punit',
  'valor', 'price', 'venta', 'precio_lista', 'lista', 'costo',
  'precio_costo', 'pcosto', 'neto', 'importe', 'tarifa',
];
const HEADER_ALIASES_NOMBRE = [
  'nombre', 'descripcion', 'producto', 'item', 'articulo', 'detalle',
  'desc', 'name', 'denominacion', 'titulo',
];
const HEADER_ALIASES_CODIGO = [
  'codigo', 'cod', 'code', 'sku', 'ref', 'referencia', 'art', 'articulo',
  'id', 'item', 'barras', 'ean',
];
const HEADER_ALIASES_UNIDAD = ['unidad', 'um', 'medida', 'unit', 'uom', 'umed'];

const UNIDADES_VALIDAS = new Set([
  'unidad', 'kg', 'litro', 'metro', 'caja', 'pack', 'gramo', 'ml',
]);

function detectarColumna(headers: string[], aliases: string[], usadas: Set<number>): number {
  const aliasesNorm = aliases.map(normalizarString);
  for (let i = 0; i < headers.length; i++) {
    if (usadas.has(i)) continue;
    const hNorm = normalizarString(headers[i]);
    if (aliasesNorm.includes(hNorm)) return i;
  }
  for (let i = 0; i < headers.length; i++) {
    if (usadas.has(i)) continue;
    const hNorm = normalizarString(headers[i]);
    if (aliasesNorm.some((a) => hNorm.includes(a) || a.includes(hNorm))) return i;
  }
  return -1;
}

function inferirUnidad(val: unknown): string | null {
  if (val == null) return null;
  const s = normalizarString(String(val));
  return UNIDADES_VALIDAS.has(s) ? s : null;
}

export function extraerItemsExcel(buffer: Buffer, nombreArchivo: string): ItemExtraidoLista[] {
  const esCsv = nombreArchivo.toLowerCase().endsWith('.csv');
  let workbook: XLSX.WorkBook;

  if (esCsv) {
    const decoder = new TextDecoder('utf-8');
    let text = decoder.decode(buffer);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    workbook = XLSX.read(text, { type: 'string' });
  } else {
    workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('El archivo est├í vac├¡o');

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: false,
  });

  if (rows.length === 0) throw new Error('El archivo no contiene datos');

  const headers = Object.keys(rows[0]).filter((h) => h && String(h).trim() !== '');
  const usadas = new Set<number>();

  const idxNombre = detectarColumna(headers, HEADER_ALIASES_NOMBRE, usadas);
  if (idxNombre >= 0) usadas.add(idxNombre);

  const idxPrecio = detectarColumna(headers, HEADER_ALIASES_PRECIO, usadas);
  if (idxPrecio >= 0) usadas.add(idxPrecio);

  const idxCodigo = detectarColumna(headers, HEADER_ALIASES_CODIGO, usadas);
  if (idxCodigo >= 0) usadas.add(idxCodigo);

  const idxUnidad = detectarColumna(headers, HEADER_ALIASES_UNIDAD, usadas);

  if (idxNombre < 0) throw new Error('No se detect├│ una columna de nombre/descripci├│n');
  if (idxPrecio < 0) throw new Error('No se detect├│ una columna de precio');

  const hNombre = headers[idxNombre];
  const hPrecio = headers[idxPrecio];
  const hCodigo = idxCodigo >= 0 ? headers[idxCodigo] : null;
  const hUnidad = idxUnidad >= 0 ? headers[idxUnidad] : null;

  const items: ItemExtraidoLista[] = [];

  for (const row of rows) {
    const nombre = row[hNombre] != null ? String(row[hNombre]).trim() : '';
    if (!nombre) continue;

    const precio = parsearPrecioArgentino(row[hPrecio]);
    if (precio == null || precio < 0) continue;

    const codigo =
      hCodigo && row[hCodigo] != null ? String(row[hCodigo]).trim() || null : null;
    const unidad = hUnidad ? inferirUnidad(row[hUnidad]) : null;

    items.push({
      orden: items.length + 1,
      codigo_proveedor: codigo,
      nombre_raw: nombre,
      nombre_normalizado: normalizarString(nombre),
      precio_lista: precio,
      unidad,
      presentacion_inferida: null,
    });
  }

  return items;
}
