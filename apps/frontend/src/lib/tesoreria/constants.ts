import type { CajaInternaPrefs } from '@/lib/business-prefs/prefs';

export const PERMISO_TESORERIA_GESTIONAR = 'tesoreria.gestionar';

export type CajaTesoreriaRow = {
  id: string;
  tenant_id: string;
  sucursal_id: string | null;
  nombre: string;
  activa: boolean;
};

export type CajaTesoreriaMovimientoTipo =
  | 'ingreso_efectivo'
  | 'egreso_efectivo'
  | 'ingreso_cheque'
  | 'egreso_cheque'
  | 'pago_proveedor'
  | 'ajuste'
  | 'transferencia_desde_caja';

export type CajaTesoreriaChequeEstado = 'en_cartera' | 'depositado' | 'entregado' | 'rechazado';

export const ETIQUETA_MOVIMIENTO_TESORERIA: Record<CajaTesoreriaMovimientoTipo, string> = {
  ingreso_efectivo: 'Ingreso efectivo',
  egreso_efectivo: 'Egreso efectivo',
  ingreso_cheque: 'Ingreso cheque',
  egreso_cheque: 'Pago proveedor (cheque)',
  pago_proveedor: 'Pago a proveedor',
  ajuste: 'Ajuste',
  transferencia_desde_caja: 'Transferencia desde caja POS',
};

export const ETIQUETA_ESTADO_CHEQUE: Record<CajaTesoreriaChequeEstado, string> = {
  en_cartera: 'En cartera',
  depositado: 'Depositado',
  entregado: 'Agotado',
  rechazado: 'Rechazado',
};

export async function provisionarCajasTesoreria(
  supabase: { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> },
  tenantId: string,
  prefs: CajaInternaPrefs,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!prefs.habilitado) return { ok: true };
  const { error } = await (supabase as any).rpc('provisionar_cajas_tesoreria', {
    p_tenant_id: tenantId,
    p_alcance: prefs.alcance,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export function resolveCajaTesoreriaFilter(
  alcance: CajaInternaPrefs['alcance'],
  sucursalId: string | null,
): { sucursal_id: null } | { sucursal_id: string } {
  if (alcance === 'tenant') return { sucursal_id: null };
  if (!sucursalId) {
    throw new Error('Se requiere sucursal para tesorería por sucursal.');
  }
  return { sucursal_id: sucursalId };
}
