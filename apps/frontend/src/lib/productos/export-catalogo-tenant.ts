import * as XLSX from 'xlsx';

export function csvEscape(v: string | number | boolean | null | undefined): string {
  const s =
    v === null || v === undefined
      ? ''
      : typeof v === 'string'
        ? v
        : v === false
          ? 'no'
          : v === true
            ? 'si'
            : String(v);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

type MiniSuc = { id: string; nombre: string; codigo: string };

type ProductoExportInput = {
  id: string;
  codigo: string;
  nombre: string;
  codigo_barras?: string | null;
  /** PLU en balanza (productos pesables); vacío si no aplica. */
  plu?: string | null;
  categoria?: { nombre?: string } | null;
  proveedor?: { nombre?: string } | null;
  unidad?: string;
  unidad_compra?: string | null;
  contenido_unidad_compra?: number | null;
  stock_actual?: number;
  stock_minimo?: number;
  comprometido?: number;
  disponible?: number;
  precio_costo?: number;
  precio_venta?: number;
  iva_porcentaje?: number | null;
  porcentaje_ganancia?: number | null;
  descuento_costo_pct?: number | null;
  margen_ganancia_pct?: number | null;
  fecha_vencimiento?: string | null;
  rubro?: string | null;
  subrubro?: string | null;
  es_pesable?: boolean;
  moneda?: string | null;
  ubicacion?: string | null;
  sucursal?: MiniSuc | null;
  sucursales_con_stock?: MiniSuc[];
  ganancia_tramos?: { cantidad_desde: number; ganancia_pct: number }[];
};

export function productoARegistroExport(p: ProductoExportInput): Record<string, string | number | boolean> {
  const dep = p.sucursal;
  const otros =
    p.sucursales_con_stock?.map((s) => `${s.nombre} (${s.codigo})`).join('; ') ?? '';
  const tramos =
    p.ganancia_tramos && p.ganancia_tramos.length > 0
      ? p.ganancia_tramos.map((t) => `${t.cantidad_desde}:${t.ganancia_pct}`).join('; ')
      : '';
  return {
    id: p.id,
    codigo: p.codigo,
    nombre: p.nombre,
    codigo_barras: p.codigo_barras ?? '',
    plu: p.plu ?? '',
    categoria: p.categoria?.nombre ?? '',
    proveedor: p.proveedor?.nombre ?? '',
    unidad: p.unidad ?? '',
    unidad_compra: p.unidad_compra ?? '',
    contenido_unidad_compra: p.contenido_unidad_compra ?? '',
    stock_actual: p.stock_actual ?? 0,
    stock_minimo: p.stock_minimo ?? 0,
    comprometido: p.comprometido ?? 0,
    disponible: p.disponible ?? 0,
    precio_costo: p.precio_costo ?? 0,
    precio_venta: p.precio_venta ?? 0,
    iva_porcentaje: p.iva_porcentaje ?? '',
    porcentaje_ganancia: p.porcentaje_ganancia ?? '',
    descuento_costo_pct: p.descuento_costo_pct ?? '',
    margen_ganancia_pct: p.margen_ganancia_pct ?? '',
    fecha_vencimiento: p.fecha_vencimiento ?? '',
    rubro: p.rubro ?? '',
    subrubro: p.subrubro ?? '',
    es_pesable: p.es_pesable === true,
    moneda: p.moneda ?? '',
    ubicacion: p.ubicacion ?? '',
    deposito_catalogo: dep?.nombre ?? '',
    deposito_catalogo_codigo: dep?.codigo ?? '',
    sucursales_stock: otros,
    ganancia_tramos: tramos,
  };
}

export const COLUMNAS_ORDEN_EXPORT_PRODUCTOS: (keyof ReturnType<typeof productoARegistroExport>)[] = [
  'id',
  'codigo',
  'nombre',
  'codigo_barras',
  'plu',
  'categoria',
  'proveedor',
  'unidad',
  'unidad_compra',
  'contenido_unidad_compra',
  'stock_actual',
  'stock_minimo',
  'comprometido',
  'disponible',
  'precio_costo',
  'precio_venta',
  'iva_porcentaje',
  'porcentaje_ganancia',
  'descuento_costo_pct',
  'margen_ganancia_pct',
  'fecha_vencimiento',
  'rubro',
  'subrubro',
  'es_pesable',
  'moneda',
  'ubicacion',
  'deposito_catalogo',
  'deposito_catalogo_codigo',
  'sucursales_stock',
  'ganancia_tramos',
];

export function registrosACsv(filas: Record<string, string | number | boolean>[]): string {
  const cols = COLUMNAS_ORDEN_EXPORT_PRODUCTOS;
  const header = cols.join(',');
  const lines = filas.map((row) => cols.map((k) => csvEscape(row[k])).join(','));
  return `\uFEFF${[header, ...lines].join('\n')}`;
}

export function registrosAXlsxBuffer(filas: Record<string, string | number | boolean>[]): Buffer {
  const wb = XLSX.utils.book_new();
  const cols = COLUMNAS_ORDEN_EXPORT_PRODUCTOS;
  let ws: XLSX.WorkSheet;
  if (filas.length === 0) {
    ws = XLSX.utils.aoa_to_sheet([cols as string[]]);
  } else {
    const data = filas.map((row) => {
      const o: Record<string, string | number | boolean> = {};
      for (const k of cols) {
        o[k] = row[k] ?? '';
      }
      return o;
    });
    ws = XLSX.utils.json_to_sheet(data, { header: cols as string[] });
  }
  XLSX.utils.book_append_sheet(wb, ws, 'Productos');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}
