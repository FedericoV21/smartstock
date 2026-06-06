import { redondear2 } from './caja-id.util';

export type AperturaVigenteRow = {
  id: string;
  opened_at: string;
  fondo_efectivo: number;
  fecha_operativa: string;
};

export function cajaAperturaIdDesdePayloadResumen(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const raw = (payload as Record<string, unknown>).caja_apertura_id;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  return null;
}

function cierreUsaInicioSesion(rangoDesde: string | undefined | null, apOpenedAt: string): boolean {
  if (rangoDesde == null || rangoDesde === '') return false;
  const t1 = new Date(rangoDesde).getTime();
  const t2 = new Date(apOpenedAt).getTime();
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return String(rangoDesde) === String(apOpenedAt);
  return Math.abs(t1 - t2) < 5000;
}

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

export function cierreDiarioMismoRangoDesde(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (a == null || b == null || a === '' || b === '') return false;
  return cierreUsaInicioSesion(a, b);
}

export type CierreDiarioRow = {
  id: string;
  caja_apertura_id?: string | null;
  payload_resumen?: unknown;
  rango_desde?: string;
  rango_hasta?: string;
};

export function aperturaEstaCerrada(
  aperturaId: string,
  openedAt: string,
  cierresDiarios: CierreDiarioRow[],
): boolean {
  for (const row of cierresDiarios) {
    const col = row.caja_apertura_id;
    if (typeof col === 'string' && col === aperturaId) return true;
    const pid = cajaAperturaIdDesdePayloadResumen(row.payload_resumen);
    if (pid === aperturaId) return true;
    if (cierreUsaInicioSesion(row.rango_desde, openedAt)) return true;
  }
  return false;
}

export function serializeAperturaVigente(ap: {
  id: string;
  openedAt: Date;
  fondoEfectivo: string;
  fechaOperativa: string;
}): AperturaVigenteRow {
  return {
    id: ap.id,
    opened_at: ap.openedAt.toISOString(),
    fondo_efectivo: redondear2(Number(ap.fondoEfectivo)),
    fecha_operativa: ap.fechaOperativa,
  };
}
