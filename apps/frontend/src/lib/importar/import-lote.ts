import {
  agruparDuplicadosPorCodigo,
  aplicarResolucionDuplicadosPorCodigo,
  filaRecomendadaUnificarMismoCodigo,
} from '@/lib/importar/duplicados-codigo-preview';
import { filaValidadaToPayload } from '@/lib/importar/fila-validada-payload';
import {
  ejecutarImportacionPorLotes,
  preflightImportacionPorLotes,
  type ImportExecutionResult,
  type PreflightImportResult,
} from '@/lib/importar/client-import';
import type { ResolucionMatchFila } from '@/components/importar/importar-match-ambiguo-dialog';
import { mapearHeaders, type MapeoColumna } from '@/lib/normalizador/mapear';
import { normalizarString } from '@/lib/normalizador/normalizar';
import { parsearArchivo, type ArchivoParseado } from '@/lib/normalizador/parsear';
import { validarFilas, type FilaValidada } from '@/lib/normalizador/validar';

export type ResultadoArchivoImportLote = {
  archivo: string;
  proveedorNombre: string | null;
  proveedorId: string | null;
  estado: 'ok' | 'parcial' | 'error';
  total_filas: number;
  filas_omitidas_preview: number;
  productos_creados: number;
  productos_actualizados: number;
  filas_con_error: number;
  detalle_errores: { fila: number; campo: string; error: string }[];
  mensaje?: string;
};

export function mapeoTieneColumnaProveedor(mapeo: MapeoColumna[]): boolean {
  return mapeo.some((m) => !m.ignorar && m.campoDetectado === 'proveedor');
}

/** Un solo nombre de proveedor por archivo (columna Proveedor). */
export function extraerNombreProveedorUnico(validas: FilaValidada[]): {
  nombre: string | null;
  error?: string;
} {
  const nombres = new Set<string>();
  for (const f of validas) {
    const raw = f.datos.proveedor;
    if (raw == null || String(raw).trim() === '') continue;
    nombres.add(String(raw).trim());
  }
  if (nombres.size === 0) {
    return { nombre: null, error: 'No hay valores en la columna Proveedor' };
  }
  if (nombres.size > 1) {
    const lista = [...nombres].slice(0, 5).join('", "');
    const mas = nombres.size > 5 ? ` (+${nombres.size - 5} más)` : '';
    return {
      nombre: null,
      error: `Varios proveedores en el mismo archivo: "${lista}"${mas}. Un CSV = un proveedor.`,
    };
  }
  return { nombre: [...nombres][0]! };
}

export function prepararFilasValidasImportLote(validadas: FilaValidada[]): {
  filas: FilaValidada[];
  omitidas: number;
} {
  const validas = validadas.filter((f) => f.valida);
  let omitidas = validadas.length - validas.length;
  const grupos = agruparDuplicadosPorCodigo(validas);
  if (grupos.length === 0) {
    return { filas: validas, omitidas };
  }
  const resolucion: Record<string, { mode: 'unificar'; filaElegidaFilaOriginal: number }> = {};
  for (const g of grupos) {
    resolucion[g.codigoClave] = {
      mode: 'unificar',
      filaElegidaFilaOriginal: filaRecomendadaUnificarMismoCodigo(g.filas),
    };
  }
  const filas = aplicarResolucionDuplicadosPorCodigo(validas, grupos, resolucion);
  omitidas += validas.length - filas.length;
  return { filas, omitidas };
}

export function buildResolucionMatchAutomatica(
  pj: PreflightImportResult,
): Record<string, ResolucionMatchFila> {
  const out: Record<string, ResolucionMatchFila> = {};
  for (const [key, raw] of Object.entries(pj.matches)) {
    if (!Array.isArray(raw) || raw.length < 2) continue;
    const first = raw[0] as { id?: string };
    if (typeof first?.id !== 'string') continue;
    const motivo = pj.requiere_resolucion[key]?.motivo;
    out[key] = {
      action: 'update',
      producto_id: first.id,
      ...(motivo === 'unidad_distinta' ? { motivo: 'unidad_distinta' as const } : {}),
    };
  }
  for (const key of Object.keys(pj.requiere_resolucion)) {
    if (out[key]) continue;
    const raw = pj.matches[key];
    if (!Array.isArray(raw) || raw.length === 0) continue;
    const first = raw[0] as { id?: string };
    if (typeof first?.id !== 'string') continue;
    out[key] = { action: 'update', producto_id: first.id, motivo: 'unidad_distinta' };
  }
  return out;
}

export async function resolverOCrearProveedorId(
  nombre: string,
  cache: Map<string, string>,
): Promise<string> {
  const key = normalizarString(nombre);
  const cached = cache.get(key);
  if (cached) return cached;

  const listRes = await fetch('/api/proveedores');
  if (!listRes.ok) {
    const j = (await listRes.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error ?? 'No se pudo listar proveedores');
  }
  const { proveedores } = (await listRes.json()) as { proveedores: { id: string; nombre: string }[] };
  const existente = (proveedores ?? []).find((p) => normalizarString(p.nombre) === key);
  if (existente) {
    cache.set(key, existente.id);
    return existente.id;
  }

  const createRes = await fetch('/api/proveedores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre }),
  });
  const cj = (await createRes.json()) as { id?: string; error?: string };
  if (!createRes.ok || !cj.id) {
    throw new Error(cj.error ?? 'No se pudo crear el proveedor');
  }
  cache.set(key, cj.id);
  return cj.id;
}

export async function procesarArchivoImportacionLote(
  file: File,
  proveedorCache: Map<string, string>,
  options?: {
    mapeo?: MapeoColumna[];
    onFileProgress?: (progress: {
      currentChunk: number;
      totalChunks: number;
      processedRows: number;
      totalRows: number;
    }) => void;
  },
): Promise<ResultadoArchivoImportLote> {
  const base: ResultadoArchivoImportLote = {
    archivo: file.name,
    proveedorNombre: null,
    proveedorId: null,
    estado: 'error',
    total_filas: 0,
    filas_omitidas_preview: 0,
    productos_creados: 0,
    productos_actualizados: 0,
    filas_con_error: 0,
    detalle_errores: [],
  };

  try {
    const parsed: ArchivoParseado = await parsearArchivo(file);
    base.total_filas = parsed.totalFilas;

    const mapeo = options?.mapeo ?? mapearHeaders(parsed.headers);
    if (!mapeoTieneColumnaProveedor(mapeo)) {
      return {
        ...base,
        mensaje:
          'Falta la columna Proveedor (o no se reconoció el encabezado). Usá el mismo formato en todos los CSV.',
      };
    }

    const validadas = validarFilas(parsed.filas, mapeo);
    const { nombre: proveedorNombre, error: errProv } = extraerNombreProveedorUnico(validadas);
    if (!proveedorNombre || errProv) {
      return { ...base, mensaje: errProv ?? 'Proveedor no definido en el archivo' };
    }
    base.proveedorNombre = proveedorNombre;

    const proveedorId = await resolverOCrearProveedorId(proveedorNombre, proveedorCache);
    base.proveedorId = proveedorId;

    const { filas: filasListas, omitidas } = prepararFilasValidasImportLote(validadas);
    base.filas_omitidas_preview = omitidas;

    if (filasListas.length === 0) {
      return {
        ...base,
        mensaje: 'No hay filas válidas para importar (revisá nombre, precios y columnas obligatorias).',
      };
    }

    let resolucion_match: Record<string, ResolucionMatchFila> | undefined;
    try {
      const pj = await preflightImportacionPorLotes({
        proveedor_id: proveedorId,
        sucursal_id: null,
        filas: filasListas.map((f) => ({
          fila_original: f.filaOriginal,
          codigo: f.datos.codigo != null ? String(f.datos.codigo) : null,
          nombre: String(f.datos.nombre ?? ''),
          unidad: f.datos.unidad != null ? String(f.datos.unidad) : null,
          codigo_barras: f.datos.codigo_barras != null ? String(f.datos.codigo_barras) : null,
        })),
      });
      resolucion_match = buildResolucionMatchAutomatica(pj);
      if (Object.keys(resolucion_match).length === 0) resolucion_match = undefined;
    } catch (e) {
      console.warn('[import-lote] preflight omitido:', e);
    }

    const resultado: ImportExecutionResult = await ejecutarImportacionPorLotes(
      {
        filas: filasListas.map(filaValidadaToPayload),
        proveedor_id: proveedorId,
        sucursal_id: null,
        archivo_nombre: file.name,
        origen: 'importacion_excel',
        cuenta_corriente_proveedor: 'sin_impacto',
        aplicar_stock_en_importacion: false,
        resolucion_match,
      },
      { onProgress: options?.onFileProgress },
    );

    base.productos_creados = resultado.productos_creados;
    base.productos_actualizados = resultado.productos_actualizados;
    base.filas_con_error = resultado.filas_con_error;
    base.detalle_errores = resultado.detalle_errores.map((e) => ({
      fila: e.fila,
      campo: e.campo,
      error: e.error,
    }));
    base.estado =
      resultado.filas_con_error > 0
        ? resultado.productos_creados + resultado.productos_actualizados > 0
          ? 'parcial'
          : 'error'
        : 'ok';
    return base;
  } catch (e) {
    return {
      ...base,
      mensaje: (e as Error).message,
    };
  }
}
