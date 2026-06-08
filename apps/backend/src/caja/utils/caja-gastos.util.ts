import { redondear2 } from './caja-id.util';

export const MAX_GASTOS_POR_SESION = 25;

export type CajaGastoSesionRow = {
  id: string;
  concepto: string;
  monto: number;
  created_at: string;
  usuario_id: string | null;
  usuario_nombre?: string | null;
};

export type GastoCierreItem = {
  concepto: string;
  monto: number;
};

function montoDesdeDb(raw: string | number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return redondear2(n);
}

export function parseGastosItemsCierre(bodyItemsRaw: unknown): {
  items: GastoCierreItem[];
  total: number;
} {
  if (!Array.isArray(bodyItemsRaw)) {
    return { items: [], total: 0 };
  }
  const items: GastoCierreItem[] = [];
  for (const raw of bodyItemsRaw) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const concepto = String(row.concepto ?? '').trim().slice(0, 200);
    const montoNum = Number(row.monto);
    if (!concepto || !Number.isFinite(montoNum) || montoNum <= 0) continue;
    items.push({ concepto, monto: redondear2(montoNum) });
  }
  const total = items.length ? redondear2(items.reduce((s, x) => s + x.monto, 0)) : 0;
  return { items, total };
}

export function gastosSesionComoCierreItems(rows: CajaGastoSesionRow[]): GastoCierreItem[] {
  return rows.map((r) => ({
    concepto: r.concepto.slice(0, 200),
    monto: r.monto,
  }));
}

export type FusionarGastosCierreResult =
  | { ok: true; items: GastoCierreItem[]; total: number }
  | { ok: false; error: string };

export function fusionarGastosCierre(
  dbGastos: CajaGastoSesionRow[],
  bodyItemsRaw: unknown,
): FusionarGastosCierreResult {
  const sesionItems = gastosSesionComoCierreItems(dbGastos);
  const extras = parseGastosItemsCierre(bodyItemsRaw);
  const items = [...sesionItems, ...extras.items];
  if (items.length > MAX_GASTOS_POR_SESION) {
    return {
      ok: false,
      error: `Máximo ${MAX_GASTOS_POR_SESION} gastos por cierre (turno + adicionales).`,
    };
  }
  const total = items.length ? redondear2(items.reduce((s, x) => s + x.monto, 0)) : 0;
  return { ok: true, items, total };
}

export function formatGastosDetalle(items: GastoCierreItem[]): string | null {
  if (!items.length) return null;
  const lineas = items.map((g) => `${g.concepto}: $${g.monto.toFixed(2)}`);
  return lineas.join('; ').slice(0, 500) || null;
}

export function serializeGastoRow(row: {
  id: string;
  concepto: string;
  monto: string | number;
  createdAt: Date;
  usuarioId: string | null;
  usuarioNombre?: string | null;
}): CajaGastoSesionRow {
  return {
    id: row.id,
    concepto: String(row.concepto ?? '').trim(),
    monto: montoDesdeDb(row.monto),
    created_at: row.createdAt.toISOString(),
    usuario_id: row.usuarioId,
    usuario_nombre: row.usuarioNombre ?? null,
  };
}

export function sumarGastosRows(rows: CajaGastoSesionRow[]): number {
  if (!rows.length) return 0;
  return redondear2(rows.reduce((s, r) => s + r.monto, 0));
}
