import { normalizarCaja, redondear2 } from '@/lib/caja/cierre-z-calculo';
import { fechaYmdArgentina } from '@/lib/utils/formatters';

/** `caja_apertura_id` en `payload_resumen` (cierres sin columna o migración incompleta). */
export function cajaAperturaIdDesdePayloadResumen(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const raw = (payload as Record<string, unknown>).caja_apertura_id;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  return null;
}

export type AperturaVigenteRow = {
  id: string;
  opened_at: string;
  fondo_efectivo: number;
  fecha_operativa: string;
};

function cierreUsaInicioSesion(rangoDesde: string | undefined | null, apOpenedAt: string): boolean {
  if (rangoDesde == null || rangoDesde === '') return false;
  const t1 = new Date(rangoDesde).getTime();
  const t2 = new Date(apOpenedAt).getTime();
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return String(rangoDesde) === String(apOpenedAt);
  return Math.abs(t1 - t2) < 5000;
}

/** Compara inicio y fin de período de un cierre diario (tolerancia por serialización de timestamps). */
export function cierreDiarioMismaVentana(
  rangoDesdeDb: string | undefined | null,
  rangoHastaDb: string | undefined | null,
  desde: string,
  hasta: string,
): boolean {
  if (rangoDesdeDb == null || rangoHastaDb == null) return false;
  const d1 = new Date(rangoDesdeDb).getTime();
  const d2 = new Date(desde).getTime();
  const h1 = new Date(rangoHastaDb).getTime();
  const h2 = new Date(hasta).getTime();
  if (![d1, d2, h1, h2].every(Number.isFinite)) {
    return String(rangoDesdeDb) === String(desde) && String(rangoHastaDb) === String(hasta);
  }
  return Math.abs(d1 - d2) < 5000 && Math.abs(h1 - h2) < 5000;
}

/** Mismo instante de inicio de período (p. ej. dos cierres diarios duplicados aunque cambie el fin del día en UTC). */
export function cierreDiarioMismoRangoDesde(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (a == null || b == null || a === '' || b === '') return false;
  return cierreUsaInicioSesion(a, b);
}

/**
 * Sesión abierta: solo la **última** apertura de la caja (por `opened_at`).
 * Queda cerrada si hay un cierre diario que enlaza su id (columna o JSON) o que
 * usa el mismo `rango_desde` que esa apertura (cierre final de esa sesión).
 * No se reutilizan aperturas viejas si hubo una más nueva ya cerrada.
 */
export async function obtenerAperturaVigente(
  supabase: any,
  cajaIdNormalizada: string,
  sucursalId: string,
): Promise<AperturaVigenteRow | null> {
  let qApertura = supabase
    .from('caja_apertura')
    .select('id, opened_at, fondo_efectivo, fecha_operativa')
    .order('opened_at', { ascending: false })
    .limit(1);
  if (cajaIdNormalizada === '__sin_caja__') {
    qApertura = qApertura.eq('caja_id', '__sin_caja__');
  } else {
    qApertura = qApertura.eq('caja_id', cajaIdNormalizada);
  }
  qApertura = qApertura.eq('sucursal_id', sucursalId);
  const { data: apRow, error: apErr } = await qApertura.maybeSingle();
  if (apErr) throw new Error(apErr.message);
  if (!apRow) return null;

  const ap = apRow as {
    id: string;
    opened_at: string;
    fondo_efectivo: string | number;
    fecha_operativa: string;
  };

  const { data: diarioRows, error: cErr } = await supabase
    .from('cierre_z')
    .select('caja_apertura_id, payload_resumen, rango_desde')
    .eq('tipo_cierre', 'diario')
    .eq('caja_id', cajaIdNormalizada)
    .eq('sucursal_id', sucursalId)
    .order('created_at', { ascending: false })
    .limit(600);
  if (cErr) throw new Error(cErr.message);

  const openedAtStr = String(ap.opened_at);
  for (const row of diarioRows ?? []) {
    const r = row as {
      caja_apertura_id?: string | null;
      payload_resumen?: unknown;
      rango_desde?: string;
    };
    const col = r.caja_apertura_id;
    if (typeof col === 'string' && col === ap.id) return null;
    const pid = cajaAperturaIdDesdePayloadResumen(r.payload_resumen);
    if (pid === ap.id) return null;
    if (cierreUsaInicioSesion(r.rango_desde, openedAtStr)) return null;
  }

  return {
    id: ap.id,
    opened_at: ap.opened_at,
    fondo_efectivo: redondear2(Number(ap.fondo_efectivo)),
    /** Día contable alineado al instante de apertura en AR (la columna en BD puede diferir por UTC). */
    fecha_operativa: fechaYmdArgentina(new Date(ap.opened_at)),
  };
}

/** Último arqueo contado en un cierre diario (solo referencia humana; no sustituye declarar apertura). */
export async function obtenerUltimoContadoCierreDiario(
  supabase: any,
  cajaIdNormalizada: string,
  sucursalId: string,
): Promise<number | null> {
  let q = supabase
    .from('cierre_z')
    .select('payload_resumen, created_at')
    .eq('tipo_cierre', 'diario')
    .order('created_at', { ascending: false })
    .limit(1);
  if (cajaIdNormalizada === '__sin_caja__') {
    q = q.eq('caja_id', '__sin_caja__');
  } else {
    q = q.eq('caja_id', cajaIdNormalizada);
  }
  q = q.eq('sucursal_id', sucursalId);
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as { payload_resumen?: { arqueo_efectivo?: { contado?: number } } } | null;
  const c = row?.payload_resumen?.arqueo_efectivo?.contado;
  if (c === undefined || c === null) return null;
  const n = Number(c);
  return Number.isFinite(n) ? redondear2(n) : null;
}

export function normalizarCajaIdParam(cajaId: string | null | undefined): string {
  return normalizarCaja(cajaId ?? null);
}
