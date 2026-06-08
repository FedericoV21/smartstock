import type { SupabaseClient } from '@supabase/supabase-js';

/** Misma leyenda que el chip del POS (`Caja 01 — Mostrador`). */
export function lineaEtiquetaCajaFisica(nombre: string, numeroPuesto: number | null | undefined): string {
  const nombreCaja = String(nombre ?? '').trim() || 'Caja';
  const n = Number(numeroPuesto);
  if (Number.isFinite(n) && n > 0) {
    return `Caja ${String(n).padStart(2, '0')} — ${nombreCaja}`;
  }
  return nombreCaja;
}

export async function lineaCajaTicketDesdeCajaUuid(
  supabase: SupabaseClient,
  cajaUuid: string | null | undefined,
): Promise<string | null> {
  const u = cajaUuid?.trim();
  if (!u) return null;
  const { data: caja, error } = await (supabase as any).from('caja').select('numero, nombre').eq('id', u).maybeSingle();
  if (error || !caja) return null;
  const row = caja as unknown as { numero?: number | null; nombre?: string | null };
  return lineaEtiquetaCajaFisica(String(row.nombre ?? ''), row.numero != null ? Number(row.numero) : null);
}
