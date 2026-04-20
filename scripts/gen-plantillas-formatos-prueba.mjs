/**
 * Genera varias plantillas CSV/XLSX con layouts distintos para probar el importador.
 * Ejecutar: node scripts/gen-plantillas-formatos-prueba.mjs
 */
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import XLSX from 'xlsx';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'public', 'plantillas', 'formatos-prueba');
mkdirSync(outDir, { recursive: true });

function csvEscape(cell) {
  const s = String(cell ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** CSV UTF-8 con BOM (Excel en Windows abre bien los acentos). El importador quita el BOM. */
function writeCsv(filename, rows) {
  const body = rows.map((r) => r.map(csvEscape).join(',')).join('\n');
  writeFileSync(join(outDir, filename), '\uFEFF' + body, 'utf8');
}

function writeXlsx(filename, aoa, sheetName = 'Datos') {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, join(outDir, filename));
}

/* --- Mismos 3 productos de ejemplo en todos los formatos (datos coherentes) --- */
const p1 = ['MAR-101', 'Martillo carpintero 16 oz', 2500, 4200, 18, 5, 'Ferretería', 'unidad', '2026-12-01'];
const p2 = ['CLA-202', 'Clavo zincado 2" bolsa x100', 890, 1500, 200, 40, 'Ferretería', 'kg', '2027-01-15'];
const p3 = ['HERR-003', 'Cinta métrica 5 m', 3200, 5200, 12, 3, 'Herramientas', 'unidad', '2026-06-30'];

// Estándar Nexus (referencia)
writeCsv('01_estandar_misma_plantilla.csv', [
  ['Código', 'Nombre', 'Precio Costo', 'Precio Venta', 'Stock', 'Stock Mínimo', 'Categoría', 'Unidad', 'Vencimiento'],
  p1,
  p2,
  p3,
]);

// Columnas en otro orden (mismos nombres de header que la plantilla oficial)
writeCsv('02_columnas_reordenadas.csv', [
  ['Vencimiento', 'Nombre', 'Stock Mínimo', 'Categoría', 'Unidad', 'Precio Venta', 'Stock', 'Código', 'Precio Costo'],
  [p1[8], p1[1], p1[5], p1[6], p1[7], p1[3], p1[4], p1[0], p1[2]],
  [p2[8], p2[1], p2[5], p2[6], p2[7], p2[3], p2[4], p2[0], p2[2]],
  [p3[8], p3[1], p3[5], p3[6], p3[7], p3[3], p3[4], p3[0], p3[2]],
]);

// Nombres tipo lista de precios / distribuidor (aliases del normalizador)
writeCsv('03_headers_distribuidor_arg.csv', [
  ['COD ART', 'DESCRIPCION', 'COSTO', 'PVP', 'EXIST', 'MIN', 'RUBRO', 'UM', 'VTO'],
  p1,
  p2,
  p3,
]);

// Inglés
writeCsv('04_headers_ingles.csv', [
  ['SKU', 'Description', 'Cost', 'List Price', 'On Hand', 'Reorder Point', 'Category', 'UOM', 'Expiry'],
  p1,
  p2,
  p3,
]);

// Mínimo: solo lo esencial + una columna de más para ignorar en mapeo
writeCsv('05_minimo_mas_notas.csv', [
  ['Producto', 'P. Venta', 'Cant', 'Notas internas'],
  ['Martillo carpintero 16 oz', '$4.200,00', 18, 'Proveedor A'],
  ['Clavo zincado 2" bolsa x100', 1500, 200, ''],
  ['Cinta métrica 5 m', 5200, 12, 'Rotación lenta'],
]);

// Columnas extra (deben ignorarse o mapearse manualmente)
writeCsv('06_con_columnas_extra.csv', [
  [
    'Código',
    'Nombre',
    'Precio Costo',
    'Precio Venta',
    'Stock',
    'Stock Mínimo',
    'Categoría',
    'Unidad',
    'Vencimiento',
    'OBSERVACIONES',
    'NRO_PEDIDO',
    'CONTACTO',
  ],
  [...p1, 'Fragil', 'PED-9921', ''],
  [...p2, '', 'PED-9921', 'Juan'],
  [...p3, 'Display', '', ''],
]);

// Precios solo con formato $ miles argentinos (prueba parseo)
writeCsv('07_precios_formato_argentina.csv', [
  ['codigo', 'nombre', 'precio_costo', 'precio_venta', 'stock', 'stock_minimo', 'categoria', 'unidad', 'fecha_vencimiento'],
  ['MAR-101', 'Martillo carpintero 16 oz', '$ 2.500,00', '$ 4.200,50', 18, 5, 'Ferretería', 'unidad', '01/12/2026'],
  ['CLA-202', 'Clavo zincado bolsa', '890,50', '$1.500,00', 200, 40, 'Ferretería', 'kg', '15-01-2027'],
  ['HERR-003', 'Cinta métrica 5 m', 3200, '5.200,00', 12, 3, 'Herramientas', 'unidad', '2026-06-30'],
]);

// XLSX: primera hoja con orden mezclado y headers “raros” mezcla
writeXlsx(
  '08_excel_headers_mixtos.xlsx',
  [
    ['PVP', 'DESCRIPCION', 'CODIGO', 'STOCK', 'VENC', 'RUBRO', 'COSTO', 'MINIMO', 'U.M.'],
    [p1[3], p1[1], p1[0], p1[4], p1[8], p1[6], p1[2], p1[5], p1[7]],
    [p2[3], p2[1], p2[0], p2[4], p2[8], p2[6], p2[2], p2[5], p2[7]],
    [p3[3], p3[1], p3[0], p3[4], p3[8], p3[6], p3[2], p3[5], p3[7]],
  ],
  'Lista'
);

// Segundo xlsx: solo dos columnas mapeables + código (usuario completa mapeo)
writeXlsx(
  '09_excel_solo_nombre_precio_codigo.xlsx',
  [
    ['Item', 'Precio lista', 'Ref'],
    ['Martillo carpintero 16 oz', 4200, 'MAR-101'],
    ['Clavo zincado 2" bolsa x100', 1500, 'CLA-202'],
    ['Cinta métrica 5 m', 5200, 'HERR-003'],
  ],
  'Productos'
);

// README simple en la misma carpeta (user asked for templates - a tiny txt is helpful)
writeFileSync(
  join(outDir, 'LEEME.txt'),
  [
    'Plantillas de prueba — formatos distintos',
    '',
    'Uso: Importar → subir cualquiera de estos archivos.',
    'Revisá el paso de mapeo si los encabezados no coinciden solos.',
    '',
    'Archivos:',
    '01_estandar_misma_plantilla.csv     — igual que la plantilla oficial',
    '02_columnas_reordenadas.csv        — mismos títulos, otro orden',
    '03_headers_distribuidor_arg.csv    — COD ART, DESCRIPCION, PVP, EXIST…',
    '04_headers_ingles.csv              — SKU, Description, Cost…',
    '05_minimo_mas_notas.csv            — pocas columnas + notas',
    '06_con_columnas_extra.csv          — columnas basura al final',
    '07_precios_formato_argentina.csv  — precios con $ y miles',
    '08_excel_headers_mixtos.xlsx       — Excel, columnas mezcladas',
    '09_excel_solo_nombre_precio_codigo.xlsx — pocos campos',
    '',
  ].join('\n'),
  'utf8'
);

console.log('OK →', outDir);
