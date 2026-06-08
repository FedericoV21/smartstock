import type { SupabaseClient } from '@supabase/supabase-js';

import { filaValidadaToPayload } from '@/lib/importar/fila-validada-payload';
import type { FilaImportacion } from '@/lib/importar/ejecutar-importacion';
import type { FilaBorradorImportacion } from '@/lib/importar/borradores';
import {
  leerChunksBorradorRango,
  validarPayloadBorrador,
} from '@/lib/importar/borradores-server';
import type { MapeoColumna } from '@/lib/normalizador/mapear';
import { validarFilas } from '@/lib/normalizador/validar';

export function filasImportDesdeRawBorrador(
  filasRaw: FilaBorradorImportacion[],
  mapeo: MapeoColumna[],
  filasIncluidas?: ReadonlySet<number>,
): FilaImportacion[] {
  const validadas = validarFilas(filasRaw, mapeo).filter((f) => f.valida);
  const payloads = validadas.map(filaValidadaToPayload);
  if (!filasIncluidas || filasIncluidas.size === 0) {
    return payloads;
  }
  return payloads.filter(
    (f) => typeof f.fila_original === 'number' && filasIncluidas.has(f.fila_original),
  );
}

export function filasIncluidasDesdePayloadBorrador(
  payload: ReturnType<typeof validarPayloadBorrador>,
): ReadonlySet<number> | undefined {
  const raw = payload.preview?.importConfirm?.filas_incluidas;
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const nums = raw.filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  return nums.length > 0 ? new Set(nums) : undefined;
}

export async function filasImportDesdeBorradorChunks(
  db: SupabaseClient,
  borradorId: string,
  mapeo: MapeoColumna[],
  chunkInicio: number,
  chunksAProcesar: number,
  filasIncluidas?: ReadonlySet<number>,
): Promise<FilaImportacion[]> {
  const chunks = await leerChunksBorradorRango(db, borradorId, chunkInicio, chunksAProcesar);
  const out: FilaImportacion[] = [];
  for (const chunk of chunks) {
    out.push(...filasImportDesdeRawBorrador(chunk.filas, mapeo, filasIncluidas));
  }
  return out;
}

export { validarPayloadBorrador };
