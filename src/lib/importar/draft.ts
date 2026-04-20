import type { ArchivoParseado } from '@/lib/normalizador/parsear';
import type { MapeoColumna } from '@/lib/normalizador/mapear';

export const IMPORT_DRAFT_KEY = 'smartstock-import-draft';
const IMPORT_DRAFT_ROWS_PREFIX = 'smartstock-import-draft-rows';
const IMPORT_DRAFT_DB_NAME = 'smartstock-imports';
const IMPORT_DRAFT_STORE_NAME = 'draftRows';

type ImportDraftArchivoMeta = Omit<ArchivoParseado, 'filas'>;

type ImportDraftStoredV1 = {
  version: 1;
  draftId: string;
  archivo: ImportDraftArchivoMeta;
  proveedorId: string | null;
  guardarPerfil: boolean;
  mapeo: MapeoColumna[];
  saltoMapeoPorPerfil?: boolean;
};

export type ImportDraftV1 = {
  version: 1;
  draftId: string;
  archivo: ArchivoParseado;
  proveedorId: string | null;
  guardarPerfil: boolean;
  mapeo: MapeoColumna[];
  /** true si el mapeo vino de proveedor.mapeo_excel y se omitió la pantalla de mapeo */
  saltoMapeoPorPerfil?: boolean;
};

function generarDraftId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function rowsFallbackKey(draftId: string): string {
  return `${IMPORT_DRAFT_ROWS_PREFIX}:${draftId}`;
}

function openDraftDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB no disponible'));
      return;
    }

    const request = indexedDB.open(IMPORT_DRAFT_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IMPORT_DRAFT_STORE_NAME)) {
        db.createObjectStore(IMPORT_DRAFT_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('No se pudo abrir IndexedDB'));
  });
}

async function putDraftRows(
  draftId: string,
  filas: Record<string, string | number | null>[],
): Promise<void> {
  if (typeof window === 'undefined') return;

  if (typeof indexedDB === 'undefined') {
    sessionStorage.setItem(rowsFallbackKey(draftId), JSON.stringify(filas));
    return;
  }

  const db = await openDraftDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IMPORT_DRAFT_STORE_NAME, 'readwrite');
    const store = tx.objectStore(IMPORT_DRAFT_STORE_NAME);
    store.put(filas, draftId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('No se pudieron guardar las filas'));
    tx.onabort = () => reject(tx.error ?? new Error('Se abortó el guardado de filas'));
  });
  db.close();
}

async function getDraftRows(
  draftId: string,
): Promise<Record<string, string | number | null>[] | null> {
  if (typeof window === 'undefined') return null;

  if (typeof indexedDB === 'undefined') {
    const raw = sessionStorage.getItem(rowsFallbackKey(draftId));
    return raw ? (JSON.parse(raw) as Record<string, string | number | null>[]) : null;
  }

  const db = await openDraftDb();
  const rows = await new Promise<Record<string, string | number | null>[] | null>((resolve, reject) => {
    const tx = db.transaction(IMPORT_DRAFT_STORE_NAME, 'readonly');
    const store = tx.objectStore(IMPORT_DRAFT_STORE_NAME);
    const request = store.get(draftId);
    request.onsuccess = () =>
      resolve(
        (request.result as Record<string, string | number | null>[] | undefined) ?? null
      );
    request.onerror = () => reject(request.error ?? new Error('No se pudieron leer las filas'));
  });
  db.close();
  return rows;
}

async function removeDraftRows(draftId: string): Promise<void> {
  if (typeof window === 'undefined') return;

  sessionStorage.removeItem(rowsFallbackKey(draftId));
  if (typeof indexedDB === 'undefined') {
    return;
  }

  const db = await openDraftDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IMPORT_DRAFT_STORE_NAME, 'readwrite');
    const store = tx.objectStore(IMPORT_DRAFT_STORE_NAME);
    store.delete(draftId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('No se pudieron borrar las filas'));
    tx.onabort = () => reject(tx.error ?? new Error('Se abortó el borrado de filas'));
  });
  db.close();
}

function esDraftLegacy(
  draft: ImportDraftV1 | ImportDraftStoredV1
): draft is ImportDraftV1 {
  return 'filas' in draft.archivo;
}

export async function readImportDraft(): Promise<ImportDraftV1 | null> {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(IMPORT_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ImportDraftV1 | ImportDraftStoredV1;
    if (parsed?.version !== 1 || !parsed.archivo?.headers) return null;

    if (esDraftLegacy(parsed)) {
      return {
        ...parsed,
        draftId: parsed.draftId ?? generarDraftId(),
      };
    }

    const filas = await getDraftRows(parsed.draftId);
    if (!filas) return null;

    return {
      ...parsed,
      archivo: {
        ...parsed.archivo,
        filas,
      },
    };
  } catch {
    return null;
  }
}

export async function writeImportDraft(draft: ImportDraftV1) {
  if (typeof window === 'undefined') return;

  const draftId = draft.draftId || generarDraftId();
  const { filas, ...archivoMeta } = draft.archivo;

  await putDraftRows(draftId, filas);
  const stored: ImportDraftStoredV1 = {
    ...draft,
    draftId,
    archivo: archivoMeta,
  };
  sessionStorage.setItem(IMPORT_DRAFT_KEY, JSON.stringify(stored));
}

export async function clearImportDraft() {
  if (typeof window === 'undefined') return;

  try {
    const raw = sessionStorage.getItem(IMPORT_DRAFT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ImportDraftStoredV1>;
      if (typeof parsed?.draftId === 'string' && parsed.draftId) {
        await removeDraftRows(parsed.draftId);
      }
    }
  } catch {
    /* ignore cleanup errors */
  }
  sessionStorage.removeItem(IMPORT_DRAFT_KEY);
}

export const IMPORT_RESULT_KEY = 'smartstock-import-result';

export type ImportResultPayload = {
  total_filas: number;
  productos_creados: number;
  productos_actualizados: number;
  filas_con_error: number;
  detalle_errores: { fila: number; campo: string; error: string; valor_original?: string }[];
  duplicadas_descartadas: number;
  archivo_nombre: string;
};

export function readImportResult(): ImportResultPayload | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(IMPORT_RESULT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ImportResultPayload;
  } catch {
    return null;
  }
}

export function writeImportResult(result: ImportResultPayload) {
  sessionStorage.setItem(IMPORT_RESULT_KEY, JSON.stringify(result));
}

export function clearImportResult() {
  sessionStorage.removeItem(IMPORT_RESULT_KEY);
}
