import { NextResponse } from 'next/server';

import { getTenantSession } from '@/lib/api/tenant-session';
import { rejectUnlessAccesoClientesApi } from '@/lib/api/permissions';
import { formatearNumeroComprobante, formatearTipoComprobante } from '@/lib/facturacion/formato';
import { formatCurrency, formatDate } from '@/lib/utils/formatters';
import type { Database } from '@/types/database';

const TIPOS_FACTURA: Database['public']['Enums']['tipo_comprobante'][] = [
  'factura_a',
  'factura_b',
  'factura_c',
];

function esErrorEnumReciboFaltante(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes('tipo_comprobante') && m.includes('recibo');
}

/** Historial de comprobantes del cliente (facturas, tickets, recibos de cobranza). */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const deniedCli = await rejectUnlessAccesoClientesApi(session.supabase, session);
  if (deniedCli) return deniedCli;

  const { id: clienteId } = await ctx.params;

  const { data: modulos, error: modErr } = await session.supabase
    .from('modulo_config')
    .select('facturador_simple, facturador_pos')
    .maybeSingle();

  if (modErr) {
    return NextResponse.json({ error: modErr.message }, { status: 500 });
  }

  if (!modulos?.facturador_simple && !modulos?.facturador_pos) {
    return NextResponse.json(
      { error: 'Activá facturación o POS para ver el historial de comprobantes.' },
      { status: 403 },
    );
  }

  const tipos: Database['public']['Enums']['tipo_comprobante'][] = [];
  if (modulos.facturador_simple) {
    tipos.push(...TIPOS_FACTURA, 'recibo');
  }
  if (modulos.facturador_pos) {
    tipos.push('ticket');
  }

  const { data: cliente, error: cliErr } = await session.supabase
    .from('cliente')
    .select('id')
    .eq('id', clienteId)
    .maybeSingle();

  if (cliErr || !cliente) {
    return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 });
  }

  const { data: tenant } = await session.supabase
    .from('tenant')
    .select('punto_de_venta')
    .maybeSingle();

  const pv = tenant?.punto_de_venta ?? 1;

  const listar = (t: Database['public']['Enums']['tipo_comprobante'][]) =>
    session.supabase
      .from('comprobante')
      .select(
        'id, tipo, numero, fecha, estado, total, pdf_url, created_at, metodo_pago, cobranza_factura ( saldo_pendiente, monto_original )',
      )
      .eq('cliente_id', clienteId)
      .in('tipo', t)
      .neq('estado', 'borrador')
      .order('numero_orden', { ascending: false })
      .order('fecha', { ascending: false })
      .order('numero', { ascending: false })
      .limit(120);

  let tiposQuery = tipos;
  let { data: rows, error } = await listar(tiposQuery);
  if (error && tiposQuery.includes('recibo') && esErrorEnumReciboFaltante(error.message)) {
    tiposQuery = tiposQuery.filter((x) => x !== 'recibo');
    ({ data: rows, error } = await listar(tiposQuery));
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const reciboIds = (rows ?? [])
    .filter((r) => r.tipo === 'recibo')
    .map((r) => r.id);

  let montoPorReciboId = new Map<string, number>();
  if (reciboIds.length > 0) {
    const { data: recibosCobranza } = await session.supabase
      .from('cobranza_pago')
      .select('recibo_comprobante_id, monto')
      .in('recibo_comprobante_id', reciboIds);

    montoPorReciboId = new Map(
      (recibosCobranza ?? [])
        .filter((r) => r.recibo_comprobante_id != null)
        .map((r) => [r.recibo_comprobante_id as string, Number(r.monto)]),
    );
  }

  const items = (rows ?? []).map((r) => {
    const totalNormalizado =
      r.tipo === 'recibo'
        ? (montoPorReciboId.get(r.id) ?? Number(r.total))
        : Number(r.total);
    const cobranza = Array.isArray(r.cobranza_factura) ? r.cobranza_factura[0] : r.cobranza_factura;
    const saldoPendiente = cobranza ? Number(cobranza.saldo_pendiente) : null;
    const montoOriginal = cobranza ? Number(cobranza.monto_original) : null;

    const esFacturaFiscal =
      r.tipo === 'factura_a' || r.tipo === 'factura_b' || r.tipo === 'factura_c';
    const esTicket = r.tipo === 'ticket';

    let estadoCobro: 'pendiente' | 'parcial' | 'pagada' | null = null;
    if (esFacturaFiscal) {
      if (saldoPendiente != null && montoOriginal != null) {
        if (saldoPendiente <= 0) {
          estadoCobro = 'pagada';
        } else if (saldoPendiente < montoOriginal) {
          estadoCobro = 'parcial';
        } else {
          estadoCobro = 'pendiente';
        }
      } else {
        estadoCobro = 'pendiente';
      }
    } else if (esTicket) {
      if (saldoPendiente != null && montoOriginal != null) {
        if (saldoPendiente <= 0) {
          estadoCobro = 'pagada';
        } else if (saldoPendiente < montoOriginal) {
          estadoCobro = 'parcial';
        } else {
          estadoCobro = 'pendiente';
        }
      } else if (
        r.metodo_pago == null ||
        (typeof r.metodo_pago === 'string' && r.metodo_pago.trim() === '')
      ) {
        // Tickets emitidos sin cobro en caja (p. ej. cuenta corriente) antes de registrar cobranza en ticket
        estadoCobro = 'pendiente';
      }
    }

    return {
      id: r.id,
      tipo: r.tipo,
      tipoLabel: formatearTipoComprobante(r.tipo),
      numeroLabel: formatearNumeroComprobante(pv, r.numero),
      fecha: r.fecha,
      fechaLabel: formatDate(r.fecha),
      estado: r.estado,
      estadoCobro,
      total: totalNormalizado,
      totalLabel: formatCurrency(totalNormalizado),
      pdf_url: r.pdf_url,
      categoria:
        r.tipo === 'ticket'
          ? ('ticket' as const)
          : r.tipo === 'recibo'
            ? ('recibo' as const)
            : ('factura' as const),
    };
  });

  return NextResponse.json({ items });
}
