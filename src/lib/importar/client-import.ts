export type FilaImportacionPayload = {
  codigo: string | null;
  nombre: string;
  precio_costo?: number | null;
  precio_venta?: number | null;
  stock_actual?: number | null;
  stock_minimo?: number | null;
  categoria?: string | null;
  unidad?: string | null;
  fecha_vencimiento?: string | null;
  codigo_barras?: string | null;
  rubro?: string | null;
  subrubro?: string | null;
  iva_porcentaje?: number | null;
  porcentaje_ganancia?: number | null;
  ubicacion?: string | null;
  moneda?: string | null;
};

export type EjecutarImportacionClientPayload = {
  filas: FilaImportacionPayload[];
  proveedor_id: string | null;
  archivo_nombre: string;
  origen: 'importacion_excel' | 'ia_pdf';
};

type ImportChunkResponse = {
  error?: string;
  total_filas?: number;
  productos_creados?: number;
  productos_actualizados?: number;
  filas_con_error?: number;
  detalle_errores?: { fila: number; campo: string; error: string; valor_original?: string }[];
};

export type ImportProgress = {
  currentChunk: number;
  totalChunks: number;
  processedRows: number;
  totalRows: number;
};

export type ImportExecutionResult = {
  total_filas: number;
  productos_creados: number;
  productos_actualizados: number;
  filas_con_error: number;
  detalle_errores: { fila: number; campo: string; error: string; valor_original?: string }[];
};

const DEFAULT_CHUNK_SIZE = 250;

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (items.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

export async function ejecutarImportacionPorLotes(
  payload: EjecutarImportacionClientPayload,
  options?: {
    chunkSize?: number;
    onProgress?: (progress: ImportProgress) => void;
  },
): Promise<ImportExecutionResult> {
  const chunkSize = Math.max(1, options?.chunkSize ?? DEFAULT_CHUNK_SIZE);
  const chunks = chunkArray(payload.filas, chunkSize);
  const totalRows = payload.filas.length;

  const acumulado: ImportExecutionResult = {
    total_filas: totalRows,
    productos_creados: 0,
    productos_actualizados: 0,
    filas_con_error: 0,
    detalle_errores: [],
  };

  for (let i = 0; i < chunks.length; i++) {
    const filasChunk = chunks[i]!;
    const rowOffset = i * chunkSize;

    options?.onProgress?.({
      currentChunk: i + 1,
      totalChunks: chunks.length,
      processedRows: rowOffset,
      totalRows,
    });

    const res = await fetch('/api/importar/ejecutar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        filas: filasChunk,
      }),
    });

    const json = (await res.json()) as ImportChunkResponse;
    if (!res.ok) {
      throw new Error(json.error ?? 'Error al importar');
    }

    acumulado.productos_creados += json.productos_creados ?? 0;
    acumulado.productos_actualizados += json.productos_actualizados ?? 0;
    acumulado.filas_con_error += json.filas_con_error ?? 0;
    acumulado.detalle_errores.push(
      ...(json.detalle_errores ?? []).map((error) => ({
        ...error,
        fila: error.fila + rowOffset,
      })),
    );

    options?.onProgress?.({
      currentChunk: i + 1,
      totalChunks: chunks.length,
      processedRows: Math.min(totalRows, rowOffset + filasChunk.length),
      totalRows,
    });
  }

  return acumulado;
}
