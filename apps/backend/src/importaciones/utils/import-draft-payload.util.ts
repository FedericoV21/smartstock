export const IMPORT_DRAFT_CHUNK_SIZE = 500;
export const IMPORT_DRAFT_MAX_BYTES = 20 * 1024 * 1024;

export type ImportDraftFlow = 'importar' | 'pdf_excel';
export type ImportDraftStep = 'mapeo' | 'preview';
export type ImportDraftOrigen = 'importacion_excel' | 'ia_pdf';

export type ImportDraftColumnMapping = {
  headerOriginal: string;
  campoDetectado: string | null;
  confianza?: 'exacta' | 'parcial' | 'ninguna';
  ignorar: boolean;
  sintetica?: boolean;
};

export type ImportDraftPayloadV1 = {
  version: 1;
  flujo: ImportDraftFlow;
  paso: ImportDraftStep;
  origenImportacion: ImportDraftOrigen;
  archivo: { nombreArchivo: string; headers: string[]; totalFilas: number };
  proveedorId?: string | null;
  guardarPerfil?: boolean;
  mapeo: ImportDraftColumnMapping[];
  saltoMapeoPorPerfil?: boolean;
  preview?: {
    forzarProductosPesables?: boolean;
    aplicarInferenciaPesablePorNombre?: boolean;
    aplicarInferenciaPresentacionCompraDesdeNombre?: boolean;
    modoGananciaImportada?: 'producto' | 'sucursal';
    productosEnlazados?: Record<string, unknown>;
    importConfirm?: { filas_incluidas?: number[]; filasIncluidas?: number[] };
  };
};

export type ImportDraftRow = Record<string, string | number | null>;

const UUID_RE = /^[0-9a-f-]{36}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function normalizeDraftFlow(raw: unknown): ImportDraftFlow | null {
  return raw === 'importar' || raw === 'pdf_excel' ? raw : null;
}

export function normalizeDraftStep(raw: unknown): ImportDraftStep | null {
  return raw === 'mapeo' || raw === 'preview' ? raw : null;
}

export function normalizeDraftOrigen(raw: unknown): ImportDraftOrigen | null {
  return raw === 'importacion_excel' || raw === 'ia_pdf' ? raw : null;
}

export function validateDraftPayload(payload: unknown): ImportDraftPayloadV1 {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Payload de borrador invalido');
  }
  const p = payload as ImportDraftPayloadV1;
  if (p.version !== 1) throw new Error('Version de borrador invalida');
  if (!normalizeDraftFlow(p.flujo)) throw new Error('Flujo de borrador invalido');
  if (!normalizeDraftStep(p.paso)) throw new Error('Paso de borrador invalido');
  if (!normalizeDraftOrigen(p.origenImportacion)) throw new Error('Origen de borrador invalido');
  if (!p.archivo || typeof p.archivo.nombreArchivo !== 'string') {
    throw new Error('Archivo de borrador invalido');
  }
  if (!Array.isArray(p.archivo.headers)) throw new Error('Headers de borrador invalidos');
  if (!Array.isArray(p.mapeo)) throw new Error('Mapeo de borrador invalido');
  return p;
}

export function metadataFromDraftPayload(payload: ImportDraftPayloadV1) {
  const proveedorId =
    typeof payload.proveedorId === 'string' && isUuid(payload.proveedorId)
      ? payload.proveedorId
      : null;
  return {
    proveedorId,
    flujo: payload.flujo,
    paso: payload.paso,
    origen: payload.origenImportacion,
    archivoNombre: payload.archivo.nombreArchivo.trim() || 'importacion',
    totalFilas: Math.max(0, Math.trunc(Number(payload.archivo.totalFilas) || 0)),
    payload: payload as unknown as Record<string, unknown>,
  };
}

export function includedRowsFromDraftPayload(
  payload: ImportDraftPayloadV1,
): ReadonlySet<number> | undefined {
  const raw =
    payload.preview?.importConfirm?.filas_incluidas ??
    payload.preview?.importConfirm?.filasIncluidas;
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const nums = raw.filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  return nums.length > 0 ? new Set(nums) : undefined;
}

export function normalizeDraftRows(raw: unknown): ImportDraftRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row): row is ImportDraftRow => Boolean(row) && typeof row === 'object' && !Array.isArray(row))
    .map((row) => row as ImportDraftRow);
}

export function chunkDraftRows<T>(filas: T[], chunkSize = IMPORT_DRAFT_CHUNK_SIZE): T[][] {
  if (filas.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < filas.length; i += chunkSize) {
    out.push(filas.slice(i, i + chunkSize));
  }
  return out;
}
