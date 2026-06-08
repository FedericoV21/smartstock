import type { SupabaseClient } from '@supabase/supabase-js';

import {
  armarExtractoProveedor,
  extractoProveedorACsv,
  type ExtractoProveedorPayload,
  type ObligacionExtractoRow,
  type PagoProveedorExtractoRow,
} from '@/lib/proveedores/extracto-proveedor';
import { resolverPeriodoReporteConLabel } from '@/lib/reportes/periodos';
import type { Database } from '@/types/database';

export async function fetchExtractoProveedor(
  supabase: SupabaseClient<Database>,
  opts: {
    tenantId: string;
    proveedorId: string;
    desde: string;
    hasta: string;
    periodoLabel: string;
  },
): Promise<ExtractoProveedorPayload | { error: string; status: number }> {
  const { data: proveedor, error: provErr } = await supabase
    .from('proveedor')
    .select('id, nombre')
    .eq('id', opts.proveedorId)
    .eq('tenant_id', opts.tenantId)
    .maybeSingle();

  if (provErr || !proveedor) {
    return { error: 'Proveedor no encontrado.', status: 404 };
  }

  const proveedorNombre = String(proveedor.nombre || 'Proveedor');

  const { data: cuenta } = await supabase
    .from('cuenta_corriente')
    .select('saldo')
    .eq('proveedor_id', opts.proveedorId)
    .maybeSingle();

  const saldoActual = cuenta?.saldo != null ? Number(cuenta.saldo) : 0;

  const { data: obligacionesRaw, error: oblErr } = await supabase
    .from('pago_proveedor_factura')
    .select(
      'id, monto_original, origen, referencia, created_at, estado, comprobante ( tipo, numero, fecha )',
    )
    .eq('proveedor_id', opts.proveedorId)
    .eq('tenant_id', opts.tenantId)
    .neq('estado', 'anulada')
    .order('created_at', { ascending: true });

  if (oblErr) {
    return { error: oblErr.message, status: 500 };
  }

  const obligaciones: ObligacionExtractoRow[] = (obligacionesRaw ?? [])
    .map((r) => {
      const c = r.comprobante;
      const cOne = Array.isArray(c) ? c[0] : c;
      const comp =
        cOne && typeof cOne === 'object'
          ? {
              tipo: String(cOne.tipo),
              numero: cOne.numero as number | string | null,
              fecha: String(cOne.fecha),
            }
          : null;
      return {
        id: r.id,
        monto_original: Number(r.monto_original),
        origen: (r.origen ?? 'comprobante') as 'comprobante' | 'import_lista',
        referencia: r.referencia,
        created_at: r.created_at,
        estado: r.estado,
        comprobante: comp,
      };
    })
    .filter((o) => {
      const fecha =
        o.comprobante?.fecha?.slice(0, 10) ?? o.created_at.slice(0, 10);
      return fecha >= opts.desde && fecha <= opts.hasta;
    });

  const { data: pagos, error: pagosErr } = await supabase
    .from('pago')
    .select('id, fecha, created_at, monto, tipo_pago, referencia, notas')
    .eq('proveedor_id', opts.proveedorId)
    .eq('tenant_id', opts.tenantId)
    .gte('fecha', opts.desde)
    .lte('fecha', opts.hasta)
    .order('fecha', { ascending: true })
    .order('created_at', { ascending: true });

  if (pagosErr) {
    return { error: pagosErr.message, status: 500 };
  }

  return armarExtractoProveedor({
    proveedorId: opts.proveedorId,
    proveedorNombre,
    periodo: { desde: opts.desde, hasta: opts.hasta, label: opts.periodoLabel },
    saldoActual,
    obligaciones,
    pagos: (pagos ?? []) as PagoProveedorExtractoRow[],
  });
}

export function periodoDesdeSearchParams(sp: URLSearchParams) {
  const { desde, hasta, label } = resolverPeriodoReporteConLabel(sp, { defaultKey: 'mes' });
  return { desde, hasta, label };
}

export { extractoProveedorACsv };
