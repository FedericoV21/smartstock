import type { AdvertenciaPerfilMapeoImport } from '@/lib/importar/draft';
import type { MapeoColumna } from '@/lib/normalizador/mapear';

export type ImportacionBorradorFlujo = 'importar' | 'pdf_excel';
export type ImportacionBorradorPaso = 'mapeo' | 'preview';
export type ImportacionBorradorOrigen = 'importacion_excel' | 'ia_pdf';

export type ImportacionBorradorPreviewPayload = {
  forzarProductosPesables?: boolean;
  aplicarInferenciaPesablePorNombre?: boolean;
  aplicarInferenciaPresentacionCompraDesdeNombre?: boolean;
  modoGananciaImportada?: 'producto' | 'sucursal';
  productosEnlazados?: Record<string, unknown>;
  /** Seteado al confirmar importación: filas válidas finales (post duplicados / descartes). */
  importConfirm?: {
    filas_incluidas?: number[];
  };
};

export type ImportacionBorradorPayloadV1 = {
  version: 1;
  flujo: ImportacionBorradorFlujo;
  paso: ImportacionBorradorPaso;
  origenImportacion: ImportacionBorradorOrigen;
  archivo: { nombreArchivo: string; headers: string[]; totalFilas: number };
  proveedorId?: string | null;
  guardarPerfil?: boolean;
  mapeo: MapeoColumna[];
  saltoMapeoPorPerfil?: boolean;
  advertenciaPerfilMapeo?: AdvertenciaPerfilMapeoImport;
  preview?: ImportacionBorradorPreviewPayload;
};

export type FilaBorradorImportacion = Record<string, string | number | null>;

export type ImportacionBorradorListItem = {
  id: string;
  flujo: ImportacionBorradorFlujo;
  paso: ImportacionBorradorPaso;
  origen: ImportacionBorradorOrigen;
  archivo_nombre: string;
  archivo_mime: string | null;
  archivo_tamano: number | null;
  total_filas: number;
  proveedor_id: string | null;
  sucursal_id: string | null;
  usuario_id: string | null;
  created_at: string;
  updated_at: string;
  proveedor?: { nombre: string } | null;
  sucursal?: { nombre: string } | null;
  usuario?: { nombre: string | null; email: string | null } | null;
  tiene_archivo?: boolean;
};

export type ImportacionBorradorDetalle = ImportacionBorradorListItem & {
  payload: ImportacionBorradorPayloadV1;
  filas: FilaBorradorImportacion[];
};

export type GuardarBorradorServidorInput = {
  id?: string | null;
  payload: ImportacionBorradorPayloadV1;
  filas: FilaBorradorImportacion[];
  originalFile?: File | Blob | null;
};

const CHUNK_SIZE = 500;

async function jsonOrError<T>(res: Response): Promise<T> {
  const raw = await res.text();
  let json: T & { error?: string };
  try {
    json = raw ? (JSON.parse(raw) as T & { error?: string }) : ({} as T & { error?: string });
  } catch {
    throw new Error(`Respuesta invalida del servidor (${res.status})`);
  }
  if (!res.ok) throw new Error(json.error ?? `Error HTTP ${res.status}`);
  return json as T;
}

export function chunkFilasBorrador<T>(filas: T[], chunkSize = CHUNK_SIZE): T[][] {
  if (filas.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < filas.length; i += chunkSize) {
    out.push(filas.slice(i, i + chunkSize));
  }
  return out;
}

export async function listarImportacionBorradores(
  flujo?: ImportacionBorradorFlujo,
): Promise<ImportacionBorradorListItem[]> {
  const params = new URLSearchParams();
  if (flujo) params.set('flujo', flujo);
  const res = await fetch(`/api/importar/borradores?${params.toString()}`, {
    cache: 'no-store',
  });
  const json = await jsonOrError<{ borradores?: ImportacionBorradorListItem[] }>(res);
  return json.borradores ?? [];
}

export async function leerImportacionBorrador(
  id: string,
): Promise<ImportacionBorradorDetalle> {
  const res = await fetch(`/api/importar/borradores/${id}`, { cache: 'no-store' });
  const json = await jsonOrError<{ borrador: ImportacionBorradorDetalle }>(res);
  return json.borrador;
}

export async function eliminarImportacionBorrador(id: string): Promise<void> {
  const res = await fetch(`/api/importar/borradores/${id}`, { method: 'DELETE' });
  await jsonOrError<Record<string, never>>(res);
}

export async function guardarImportacionBorradorServidor({
  id,
  payload,
  filas,
  originalFile,
}: GuardarBorradorServidorInput): Promise<ImportacionBorradorListItem> {
  const body = JSON.stringify({ payload });
  const base = id
    ? await jsonOrError<{ borrador: ImportacionBorradorListItem }>(
        await fetch(`/api/importar/borradores/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body,
        }),
      )
    : await jsonOrError<{ borrador: ImportacionBorradorListItem }>(
        await fetch('/api/importar/borradores', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        }),
      );

  const borrador = base.borrador;
  await jsonOrError<Record<string, never>>(
    await fetch(`/api/importar/borradores/${borrador.id}/chunks`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filas }),
    }),
  );

  if (originalFile) {
    const fd = new FormData();
    const file =
      originalFile instanceof File
        ? originalFile
        : new File([originalFile], payload.archivo.nombreArchivo);
    fd.append('file', file, payload.archivo.nombreArchivo);
    await jsonOrError<Record<string, never>>(
      await fetch(`/api/importar/borradores/${borrador.id}/archivo`, {
        method: 'POST',
        body: fd,
      }),
    );
  }

  return borrador;
}

export type PrepararConfirmacionBorradorResult = {
  carga_id: string;
  sucursal_id: string | null;
  archivo_storage_path: string | null;
  archivo_mime: string | null;
  archivo_tamano: number | null;
  chunk_count: number;
};

export async function prepararConfirmacionImportacionBorrador(
  id: string,
  options?: { filas_incluidas?: number[] },
): Promise<PrepararConfirmacionBorradorResult> {
  const res = await fetch(`/api/importar/borradores/${id}/preparar-confirmacion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filas_incluidas: options?.filas_incluidas ?? null,
    }),
  });
  return jsonOrError<PrepararConfirmacionBorradorResult>(res);
}
