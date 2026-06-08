import { loadEffectiveBusinessPrefs } from '@/lib/business-prefs/server';
import type { BusinessPrefs } from '@/lib/business-prefs/prefs';
import { normalizeCajaPrefs, type CajaPrefs } from '@/lib/caja/prefs';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

/** Lee flag persistido al emitir (metodo_pago_detalle.ticket_ocultar_importes). */
export function ticketOcultarImportesDesdeDetallePago(
  metodoPago: string | null | undefined,
  detalle: unknown,
): boolean {
  if ((metodoPago ?? '').trim() !== 'cuenta_corriente') return false;
  if (!detalle || typeof detalle !== 'object' || Array.isArray(detalle)) return false;
  return (detalle as { ticket_ocultar_importes?: unknown }).ticket_ocultar_importes === true;
}

/**
 * Ticket CC sin importes: sucursal habilita ajustes por caja + caja con toggle ON + venta CC.
 */
export function resolverTicketOcultarImportesCc(params: {
  metodoPago: string | null | undefined;
  businessPrefs: BusinessPrefs;
  cajaPrefs: CajaPrefs;
  /** Si el comprobante ya guardó el modo al emitir, tiene prioridad (reimpresión). */
  persistidoEnComprobante?: boolean;
}): boolean {
  if (params.persistidoEnComprobante === true) return true;
  if ((params.metodoPago ?? '').trim() !== 'cuenta_corriente') return false;
  if (!params.businessPrefs.cuentaCorrienteDistribuidora.permitirAjustesPorCaja) return false;
  return params.cajaPrefs.cuentaCorrienteCaja.ticketOcultarImportes === true;
}

export function metodoPagoDetalleConTicketOcultarImportes(
  detalle: Record<string, unknown> | null | undefined,
  ocultar: boolean,
): Record<string, unknown> | null {
  if (!ocultar) return detalle ?? null;
  return { ...(detalle ?? {}), ticket_ocultar_importes: true };
}

/** Resuelve en servidor según prefs de sucursal y caja al emitir. */
export async function loadTicketOcultarImportesCcActivo(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  sucursalId: string,
  cajaUuid: string | null | undefined,
  metodoPago: string | null | undefined,
): Promise<boolean> {
  const cajaId = cajaUuid?.trim() ?? '';
  if (!cajaId) return false;
  const businessPrefs = await loadEffectiveBusinessPrefs(supabase, tenantId, sucursalId);
  const { data: cajaRow } = await supabase
    .from('caja')
    .select('prefs')
    .eq('tenant_id', tenantId)
    .eq('id', cajaId)
    .maybeSingle();
  const cajaPrefs = normalizeCajaPrefs(
    (cajaRow as { prefs?: unknown } | null)?.prefs,
  );
  return resolverTicketOcultarImportesCc({
    metodoPago,
    businessPrefs,
    cajaPrefs,
  });
}
