import * as XLSX from 'xlsx';

import type { CampoProducto } from '@/lib/normalizador/aliases';
import type { MapeoColumna } from '@/lib/normalizador/mapear';

type FilaRaw = Record<string, string | number | null>;

export const CAMPOS_EXPORTACION_IMPORTADOR: CampoProducto[] = [
  'codigo',
  'nombre',
  'precio_costo',
  'precio_venta',
  'stock_actual',
  'stock_minimo',
  'categoria',
  'unidad',
  'unidad_compra',
  'contenido_unidad_compra',
  'codigo_barras',
  'rubro',
  'subrubro',
  'iva_porcentaje',
  'porcentaje_ganancia',
  'ubicacion',
  'moneda',
];

export type ColumnaExportacionMapeada = {
  campo: CampoProducto;
  headerOriginal: string;
};

export function columnasExportacionDesdeMapeo(
  mapeo: MapeoColumna[],
): ColumnaExportacionMapeada[] {
  const headersPorCampo = new Map<CampoProducto, string>();
  const camposPermitidos = new Set(CAMPOS_EXPORTACION_IMPORTADOR);

  for (const col of mapeo) {
    if (col.ignorar || !col.campoDetectado || !camposPermitidos.has(col.campoDetectado)) {
      continue;
    }
    if (!headersPorCampo.has(col.campoDetectado)) {
      headersPorCampo.set(col.campoDetectado, col.headerOriginal);
    }
  }

  return CAMPOS_EXPORTACION_IMPORTADOR.flatMap((campo) => {
    const headerOriginal = headersPorCampo.get(campo);
    return headerOriginal ? [{ campo, headerOriginal }] : [];
  });
}

function valorExportable(v: string | number | null | undefined): string | number {
  return v == null ? '' : v;
}

export function filasExportacionDesdeMapeo(
  filasRaw: FilaRaw[],
  mapeo: MapeoColumna[],
): Record<string, string | number>[] {
  const columnas = columnasExportacionDesdeMapeo(mapeo);
  return filasRaw.map((fila) => {
    const out: Record<string, string | number> = {};
    for (const col of columnas) {
      out[col.campo] = valorExportable(fila[col.headerOriginal]);
    }
    return out;
  });
}

function csvEscape(v: string | number): string {
  const s = String(v);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function tablaMapeadaACsv(filasRaw: FilaRaw[], mapeo: MapeoColumna[]): string {
  const columnas = columnasExportacionDesdeMapeo(mapeo);
  const headers = columnas.map((c) => c.campo);
  const filas = filasExportacionDesdeMapeo(filasRaw, mapeo);
  const lines = filas.map((fila) => headers.map((h) => csvEscape(fila[h] ?? '')).join(','));
  return `\uFEFF${[headers.join(','), ...lines].join('\n')}`;
}

export function tablaMapeadaAXlsxArrayBuffer(
  filasRaw: FilaRaw[],
  mapeo: MapeoColumna[],
): ArrayBuffer {
  const columnas = columnasExportacionDesdeMapeo(mapeo);
  const headers = columnas.map((c) => c.campo);
  const filas = filasExportacionDesdeMapeo(filasRaw, mapeo);
  const wb = XLSX.utils.book_new();
  const ws =
    filas.length === 0
      ? XLSX.utils.aoa_to_sheet([headers])
      : XLSX.utils.json_to_sheet(filas, { header: headers });

  XLSX.utils.book_append_sheet(wb, ws, 'Lista');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

export function nombreArchivoConvertido(nombreOriginal: string, extension: 'csv' | 'xlsx'): string {
  const base =
    nombreOriginal
      .trim()
      .replace(/\.[^.\\/]+$/, '')
      .replace(/[/\\?%*:|"<>]/g, '_')
      .trim() || 'lista';
  return `${base}-convertida.${extension}`;
}

