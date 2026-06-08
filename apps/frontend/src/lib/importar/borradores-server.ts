import crypto from 'node:crypto';

import type { TenantSession } from '@/lib/api/tenant-session';
import type {
  FilaBorradorImportacion,
  ImportacionBorradorFlujo,
  ImportacionBorradorListItem,
  ImportacionBorradorOrigen,
  ImportacionBorradorPayloadV1,
  ImportacionBorradorPaso,
} from '@/lib/importar/borradores';

type ActiveSession = Exclude<TenantSession, { error: unknown }>;

export const IMPORTACION_BORRADOR_CHUNK_SIZE = 500;
export const IMPORTACION_BORRADOR_MAX_BYTES = 20 * 1024 * 1024;

export function uuidOk(id: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(id);
}

export function esAdminBorradores(session: ActiveSession): boolean {
  return session.isSuperAdmin || session.rol === 'admin';
}

export function normalizarFlujo(raw: unknown): ImportacionBorradorFlujo | null {
  return raw === 'importar' || raw === 'pdf_excel' ? raw : null;
}

export function normalizarPaso(raw: unknown): ImportacionBorradorPaso | null {
  return raw === 'mapeo' || raw === 'preview' ? raw : null;
}

export function normalizarOrigen(raw: unknown): ImportacionBorradorOrigen | null {
  return raw === 'importacion_excel' || raw === 'ia_pdf' ? raw : null;
}

export function validarPayloadBorrador(payload: unknown): ImportacionBorradorPayloadV1 {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Payload de borrador invalido');
  }
  const p = payload as ImportacionBorradorPayloadV1;
  if (p.version !== 1) throw new Error('Version de borrador invalida');
  if (!normalizarFlujo(p.flujo)) throw new Error('Flujo de borrador invalido');
  if (!normalizarPaso(p.paso)) throw new Error('Paso de borrador invalido');
  if (!normalizarOrigen(p.origenImportacion)) throw new Error('Origen de borrador invalido');
  if (!p.archivo || typeof p.archivo.nombreArchivo !== 'string') {
    throw new Error('Archivo de borrador invalido');
  }
  if (!Array.isArray(p.archivo.headers)) throw new Error('Headers de borrador invalidos');
  if (!Array.isArray(p.mapeo)) throw new Error('Mapeo de borrador invalido');
  return p;
}

export function metadataDesdePayload(payload: ImportacionBorradorPayloadV1) {
  const proveedorId =
    typeof payload.proveedorId === 'string' && uuidOk(payload.proveedorId)
      ? payload.proveedorId
      : null;
  return {
    proveedor_id: proveedorId,
    flujo: payload.flujo,
    paso: payload.paso,
    origen: payload.origenImportacion,
    archivo_nombre: payload.archivo.nombreArchivo.trim() || 'importacion',
    total_filas: Math.max(0, Math.trunc(Number(payload.archivo.totalFilas) || 0)),
    payload: payload as unknown as Record<string, unknown>,
  };
}

export function puedeAccederBorrador(
  session: ActiveSession,
  row: { usuario_id?: string | null },
): boolean {
  return esAdminBorradores(session) || row.usuario_id === session.userId;
}

export function chunkFilasServidor<T>(filas: T[], chunkSize = IMPORTACION_BORRADOR_CHUNK_SIZE): T[][] {
  if (filas.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < filas.length; i += chunkSize) {
    out.push(filas.slice(i, i + chunkSize));
  }
  return out;
}

export function normalizarFilasBorrador(raw: unknown): FilaBorradorImportacion[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row): row is FilaBorradorImportacion => Boolean(row) && typeof row === 'object' && !Array.isArray(row))
    .map((row) => row as FilaBorradorImportacion);
}

export async function reemplazarChunksBorrador(
  db: any,
  borradorId: string,
  filas: FilaBorradorImportacion[],
): Promise<void> {
  const { error: delErr } = await db
    .from('importacion_borrador_chunk')
    .delete()
    .eq('borrador_id', borradorId);
  if (delErr) throw new Error(delErr.message);

  const chunks = chunkFilasServidor(filas);
  if (chunks.length === 0) return;

  const rows = chunks.map((chunk, chunkIndex) => ({
    borrador_id: borradorId,
    chunk_index: chunkIndex,
    row_count: chunk.length,
    filas: chunk,
  }));
  const { error } = await db.from('importacion_borrador_chunk').insert(rows);
  if (error) throw new Error(error.message);
}

export async function leerFilasBorrador(
  db: any,
  borradorId: string,
): Promise<FilaBorradorImportacion[]> {
  const { data, error } = await db
    .from('importacion_borrador_chunk')
    .select('chunk_index, filas')
    .eq('borrador_id', borradorId)
    .order('chunk_index', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).flatMap((r: { filas?: unknown }) => normalizarFilasBorrador(r.filas));
}

export async function contarChunksBorrador(db: any, borradorId: string): Promise<number> {
  const { count, error } = await db
    .from('importacion_borrador_chunk')
    .select('id', { count: 'exact', head: true })
    .eq('borrador_id', borradorId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export type BorradorChunkLeido = {
  chunk_index: number;
  filas: FilaBorradorImportacion[];
};

export async function leerChunksBorradorRango(
  db: any,
  borradorId: string,
  chunkInicio: number,
  cantidad: number,
): Promise<BorradorChunkLeido[]> {
  if (cantidad <= 0) return [];
  const chunkFin = chunkInicio + cantidad - 1;
  const { data, error } = await db
    .from('importacion_borrador_chunk')
    .select('chunk_index, filas')
    .eq('borrador_id', borradorId)
    .gte('chunk_index', chunkInicio)
    .lte('chunk_index', chunkFin)
    .order('chunk_index', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: { chunk_index: number; filas?: unknown }) => ({
    chunk_index: r.chunk_index,
    filas: normalizarFilasBorrador(r.filas),
  }));
}

export function mapBorradorListItem(row: any): ImportacionBorradorListItem {
  const archivo = row.importacion_borrador_archivo;
  return {
    id: row.id,
    flujo: row.flujo,
    paso: row.paso,
    origen: row.origen,
    archivo_nombre: row.archivo_nombre,
    archivo_mime: row.archivo_mime ?? null,
    archivo_tamano: row.archivo_tamano ?? null,
    total_filas: row.total_filas ?? 0,
    proveedor_id: row.proveedor_id ?? null,
    sucursal_id: row.sucursal_id ?? null,
    usuario_id: row.usuario_id ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    proveedor: row.proveedor ?? null,
    sucursal: row.sucursal ?? null,
    usuario: row.usuario ?? null,
    tiene_archivo: Array.isArray(archivo) ? archivo.length > 0 : Boolean(archivo),
  };
}

export function nuevoCargaId(): string {
  return crypto.randomUUID();
}
