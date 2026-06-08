import { redondear2 } from '@/lib/caja/cierre-z-calculo';
import type { GastoCierreItem } from '@/lib/caja/gastos-cierre';
import { parseGastosItemsCierre } from '@/lib/caja/gastos-cierre';

const MAX_LINEAS = 25;

export type CajaGastoSesionRow = {
  id: string;
  concepto: string;
  monto: number;
  created_at: string;
  usuario_id: string | null;
  usuario_nombre?: string | null;
};

export type FusionarGastosCierreResult =
  | { ok: true; items: GastoCierreItem[]; total: number }
  | { ok: false; error: string };

function montoDesdeDb(raw: string | number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return redondear2(n);
}

/** Gastos vigentes de la sesión: no anulados y aún no incluidos en un cierre. */
export async function listarGastosSesionVigentes(
  supabase: any,
  aperturaId: string,
): Promise<CajaGastoSesionRow[]> {
  const { data, error } = await supabase
    .from('caja_gasto')
    .select('id, concepto, monto, created_at, usuario_id, usuario:usuario_id(nombre)')
    .eq('caja_apertura_id', aperturaId)
    .is('anulado_at', null)
    .is('cierre_z_id', null)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);

  return (data ?? []).map((row: Record<string, unknown>) => {
    const usuario = row.usuario as { nombre?: string | null } | null;
    return {
      id: String(row.id),
      concepto: String(row.concepto ?? '').trim(),
      monto: montoDesdeDb(row.monto as string | number),
      created_at: String(row.created_at),
      usuario_id: row.usuario_id ? String(row.usuario_id) : null,
      usuario_nombre: usuario?.nombre ?? null,
    };
  });
}

export async function sumarGastosSesion(supabase: any, aperturaId: string): Promise<number> {
  const rows = await listarGastosSesionVigentes(supabase, aperturaId);
  if (!rows.length) return 0;
  return redondear2(rows.reduce((s, r) => s + r.monto, 0));
}

export function gastosSesionComoCierreItems(rows: CajaGastoSesionRow[]): GastoCierreItem[] {
  return rows.map((r) => ({
    concepto: r.concepto.slice(0, 200),
    monto: r.monto,
  }));
}

/**
 * Une gastos registrados durante el turno con extras enviados al cierre.
 * Los del turno van primero; el body solo aporta líneas adicionales.
 */
export function fusionarGastosCierre(
  dbGastos: CajaGastoSesionRow[],
  bodyItemsRaw: unknown,
): FusionarGastosCierreResult {
  const sesionItems = gastosSesionComoCierreItems(dbGastos);
  const extras = parseGastosItemsCierre(bodyItemsRaw);
  const items = [...sesionItems, ...extras.items];
  if (items.length > MAX_LINEAS) {
    return {
      ok: false,
      error: `Máximo ${MAX_LINEAS} gastos por cierre (turno + adicionales).`,
    };
  }
  const total = items.length ? redondear2(items.reduce((s, x) => s + x.monto, 0)) : 0;
  return { ok: true, items, total };
}

/** Marca los gastos vigentes de la sesión como incluidos en el cierre Z. */
export async function marcarGastosIncluidosEnCierre(
  supabase: any,
  aperturaId: string,
  cierreZId: string,
): Promise<void> {
  const { error } = await supabase
    .from('caja_gasto')
    .update({ cierre_z_id: cierreZId })
    .eq('caja_apertura_id', aperturaId)
    .is('anulado_at', null)
    .is('cierre_z_id', null);
  if (error) throw new Error(error.message);
}

export async function resolverGastosParaCierreDiario(
  supabase: any,
  sesionAperturaId: string | null,
  bodyItemsRaw: unknown,
): Promise<FusionarGastosCierreResult & { itemsGuardados: GastoCierreItem[] | null }> {
  if (!sesionAperturaId) {
    const extras = parseGastosItemsCierre(bodyItemsRaw);
    return {
      ok: true,
      items: extras.items,
      total: extras.total,
      itemsGuardados: extras.items.length > 0 ? extras.items : null,
    };
  }

  const dbGastos = await listarGastosSesionVigentes(supabase, sesionAperturaId);
  const fusion = fusionarGastosCierre(dbGastos, bodyItemsRaw);
  if (!fusion.ok) {
    return { ...fusion, itemsGuardados: null };
  }
  return {
    ...fusion,
    itemsGuardados: fusion.items.length > 0 ? fusion.items : null,
  };
}
