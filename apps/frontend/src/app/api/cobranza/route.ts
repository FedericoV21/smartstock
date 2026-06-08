import { NextResponse } from 'next/server';

import { getTenantSession } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';
import { formatearNumeroComprobante, formatearTipoComprobante } from '@/lib/facturacion/formato';
import { formatCurrency, formatDate } from '@/lib/utils/formatters';
import type { Database } from '@/types/database';

type ClienteMini = Pick<Database['public']['Tables']['cliente']['Row'], 'nombre' | 'telefono'>;
type ComprobanteMini = Pick<
  Database['public']['Tables']['comprobante']['Row'],
  'numero' | 'tipo' | 'pdf_url' | 'total'
>;

/** Listado de cobranzas abiertas; si viene `cliente_id`, filtra por ese cliente (p. ej. ficha). */
export async function GET(request: Request) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const guard = await moduloGuard('facturador_simple');
  if (!guard.allowed) return guard.response;

  const { searchParams } = new URL(request.url);
  const clienteId = searchParams.get('cliente_id');

  const { data: tenant } = await session.supabase
    .from('tenant')
    .select('punto_de_venta')
    .maybeSingle();

  const pv = tenant?.punto_de_venta ?? 1;

  let q = session.supabase
    .from('cobranza_factura')
    .select(
      `
      id,
      saldo_pendiente,
      vencimiento_at,
      recordatorio_snooze_until,
      monto_original,
      comprobante_id,
      cliente:cliente_id ( nombre, telefono ),
      comprobante:comprobante_id ( numero, tipo, pdf_url, total )
    `,
    )
    .gt('saldo_pendiente', 0)
    .order('vencimiento_at', { ascending: true });

  if (clienteId) {
    q = q.eq('cliente_id', clienteId);
  }

  const { data: rows, error } = await q;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const items = (rows ?? []).map((raw) => {
    const r = raw as Database['public']['Tables']['cobranza_factura']['Row'] & {
      cliente: ClienteMini | null;
      comprobante: ComprobanteMini | null;
    };
    const comp = r.comprobante;
    const cli = r.cliente;
    return {
      id: r.id,
      saldoPendiente: Number(r.saldo_pendiente),
      montoOriginal: Number(r.monto_original),
      vencimientoAt: r.vencimiento_at,
      vencimientoLabel: formatDate(r.vencimiento_at),
      recordatorioSnoozeUntil: r.recordatorio_snooze_until,
      comprobanteId: r.comprobante_id,
      numeroComprobanteLabel: comp ? formatearNumeroComprobante(pv, comp.numero) : '',
      tipoComprobanteLabel: comp ? formatearTipoComprobante(comp.tipo) : '',
      totalFactura: comp ? Number(comp.total) : 0,
      pdfUrl: comp?.pdf_url ?? null,
      clienteNombre: cli?.nombre ?? '',
      saldoLabel: formatCurrency(Number(r.saldo_pendiente)),
    };
  });

  return NextResponse.json({ items });
}
