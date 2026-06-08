import type { SupabaseClient } from '@supabase/supabase-js';

import {
  enriquecerLineasExtractoEditables,
  type ExtractoLineaConEdicion,
} from '@/lib/cuenta-corriente/extracto-editabilidad';
import {
  armarExtractoCuentaCorriente,
  extractoACsv,
  type ComprobanteExtractoRow,
  type ExtractoPayload,
  type PagoExtractoRow,
} from '@/lib/cuenta-corriente/extracto';
import { resolverPeriodoReporteConLabel } from '@/lib/reportes/periodos';
import type { Database } from '@/types/database';

export type ExtractoPayloadConEdicion = Omit<ExtractoPayload, 'lineas'> & {
  lineas: ExtractoLineaConEdicion[];
};

export async function fetchExtractoCuentaCorriente(
  supabase: SupabaseClient<Database>,
  opts: {
    tenantId: string;
    clienteId: string;
    desde: string;
    hasta: string;
    periodoLabel: string;
    sucursalId: string | null;
    puedeEditar?: boolean;
    liquidacionHabilitada?: boolean;
    liquidacionPorSucursal?: Record<string, boolean>;
  },
): Promise<ExtractoPayloadConEdicion | { error: string; status: number }> {
  const { data: cliente, error: cliErr } = await supabase
    .from('cliente')
    .select('id, nombre, razon_social')
    .eq('id', opts.clienteId)
    .eq('tenant_id', opts.tenantId)
    .maybeSingle();

  if (cliErr || !cliente) {
    return { error: 'Cliente no encontrado.', status: 404 };
  }

  const clienteNombre = String(cliente.razon_social || cliente.nombre || 'Cliente');

  const { data: cuenta } = await supabase
    .from('cuenta_corriente')
    .select('saldo')
    .eq('cliente_id', opts.clienteId)
    .maybeSingle();

  const saldoActual = cuenta?.saldo != null ? Number(cuenta.saldo) : 0;

  const { data: tenant } = await supabase
    .from('tenant')
    .select('punto_de_venta')
    .eq('id', opts.tenantId)
    .maybeSingle();

  const pv = tenant?.punto_de_venta ?? 1;

  let compQuery = supabase
    .from('comprobante')
    .select(
      'id, tipo, numero, numero_caja, fecha, created_at, total, metodo_pago, metodo_pago_detalle, sucursal_id, estado, cae',
    )
    .eq('cliente_id', opts.clienteId)
    .eq('tenant_id', opts.tenantId)
    .gte('fecha', opts.desde)
    .lte('fecha', opts.hasta)
    .in('estado', ['emitido', 'pendiente_arca']);

  if (opts.sucursalId) {
    compQuery = compQuery.eq('sucursal_id', opts.sucursalId);
  }

  const { data: comprobantes, error: compErr } = await compQuery.order('fecha', { ascending: true }).order('created_at', { ascending: true });

  if (compErr) {
    return { error: compErr.message, status: 500 };
  }

  const { data: pagos, error: pagosErr } = await supabase
    .from('pago')
    .select('id, fecha, created_at, monto, tipo_pago, referencia, notas, comprobante_id')
    .eq('cliente_id', opts.clienteId)
    .eq('tenant_id', opts.tenantId)
    .gte('fecha', opts.desde)
    .lte('fecha', opts.hasta)
    .order('fecha', { ascending: true })
    .order('created_at', { ascending: true });

  if (pagosErr) {
    return { error: pagosErr.message, status: 500 };
  }

  let pagosRows = (pagos ?? []) as PagoExtractoRow[];
  if (opts.sucursalId && pagosRows.length > 0) {
    const compIds = [...new Set(pagosRows.map((p) => p.comprobante_id).filter(Boolean))] as string[];
    let compSucursal = new Set<string>();
    if (compIds.length > 0) {
      const { data: compSuc } = await supabase
        .from('comprobante')
        .select('id')
        .in('id', compIds)
        .eq('sucursal_id', opts.sucursalId);
      compSucursal = new Set((compSuc ?? []).map((c) => c.id));
    }
    pagosRows = pagosRows.filter((p) => !p.comprobante_id || compSucursal.has(p.comprobante_id));
  }

  const comprobantesRows = (comprobantes ?? []) as ComprobanteExtractoRow[];
  const base = armarExtractoCuentaCorriente({
    clienteId: opts.clienteId,
    clienteNombre,
    periodo: { desde: opts.desde, hasta: opts.hasta, label: opts.periodoLabel },
    sucursalId: opts.sucursalId,
    saldoActual,
    comprobantes: comprobantesRows,
    pagos: pagosRows,
    puntoDeVenta: pv,
  });

  const lineas = enriquecerLineasExtractoEditables({
    lineas: base.lineas,
    comprobantes: comprobantesRows,
    liquidacionHabilitada: opts.liquidacionHabilitada ?? false,
    liquidacionPorSucursal: opts.liquidacionPorSucursal,
    puedeEditar: opts.puedeEditar ?? false,
  });

  return { ...base, lineas };
}

export function periodoDesdeSearchParams(sp: URLSearchParams) {
  const { desde, hasta, label } = resolverPeriodoReporteConLabel(sp, { defaultKey: 'mes' });
  return { desde, hasta, label };
}

export { extractoACsv };
