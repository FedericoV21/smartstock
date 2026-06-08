import { NextResponse } from 'next/server';

import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession } from '@/lib/api/tenant-session';
import { resolverPeriodoReporte } from '@/lib/reportes/periodos';
import { fetchAllRows } from '@/lib/supabase/fetch-all';
import type { Database } from '@/types/database';

type TipoPago = Database['public']['Enums']['tipo_pago'];

function csvEscape(v: string | number): string {
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function esUuidCliente(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function etiquetaTipoPago(t: TipoPago): string {
  switch (t) {
    case 'efectivo':
      return 'Efectivo';
    case 'transferencia':
      return 'Transferencia';
    case 'cheque':
      return 'Cheque';
    case 'tarjeta':
      return 'Tarjeta';
    case 'otro':
      return 'Otro';
    default:
      return t;
  }
}

function buildCobranzaPagoSelect(clienteFiltro: string | null, sid: string | null): string {
  if (sid && clienteFiltro) {
    return `
        id,
        fecha,
        monto,
        tipo_pago,
        cobranza_factura:cobranza_factura_id!inner (
          cliente_id,
          cliente:cliente_id ( nombre ),
          comprobante:comprobante_id!inner ( sucursal_id )
        )
      `;
  }
  if (sid) {
    return `
        id,
        fecha,
        monto,
        tipo_pago,
        cobranza_factura:cobranza_factura_id!inner (
          cliente:cliente_id ( nombre ),
          comprobante:comprobante_id!inner ( sucursal_id )
        )
      `;
  }
  if (clienteFiltro) {
    return `
        id,
        fecha,
        monto,
        tipo_pago,
        cobranza_factura:cobranza_factura_id!inner (
          cliente_id,
          cliente:cliente_id ( nombre )
        )
      `;
  }
  return `
        id,
        fecha,
        monto,
        tipo_pago,
        cobranza_factura:cobranza_factura_id (
          cliente:cliente_id ( nombre )
        )
      `;
}

export async function GET(request: Request) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const sp = new URL(request.url).searchParams;
  const sucursalScope = await resolveAndValidateSucursalScope(session, sp.get('sucursal_id'));
  if (!sucursalScope.ok) return sucursalScope.response;
  const exportFmt = (sp.get('export') || '').toLowerCase();
  const { desde, hasta, key } = resolverPeriodoReporte(sp);
  const clienteIdRaw = (sp.get('cliente_id') || '').trim();
  const clienteFiltro = esUuidCliente(clienteIdRaw) ? clienteIdRaw : null;
  const sid = sucursalScope.sucursalId;

  const buildRecibosQuery = () => {
    let q = session.supabase
      .from('comprobante')
      .select('id, fecha, numero, total, metodo_pago, cliente_id, cliente:cliente_id(nombre)')
      .eq('tipo', 'recibo')
      .eq('estado', 'emitido')
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .order('fecha', { ascending: false });
    if (sid) q = q.eq('sucursal_id', sid);
    if (clienteFiltro) q = q.eq('cliente_id', clienteFiltro);
    return q;
  };

  const buildCobranzaQuery = () => {
    let q = session.supabase
      .from('cobranza_pago')
      .select(buildCobranzaPagoSelect(clienteFiltro, sid).replace(/\s+/g, ' ').trim())
      .is('recibo_comprobante_id', null)
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .order('fecha', { ascending: false });
    if (sid) q = q.eq('cobranza_factura.comprobante.sucursal_id', sid);
    if (clienteFiltro) q = q.eq('cobranza_factura.cliente_id', clienteFiltro);
    return q;
  };

  const qPagoCcExec = sid
    ? Promise.resolve({ data: [], error: null })
    : fetchAllRows(() => {
        let q = session.supabase
          .from('pago')
          .select('id, fecha, monto, tipo_pago, referencia, cliente:cliente_id(nombre)')
          .is('comprobante_id', null)
          .gte('fecha', desde)
          .lte('fecha', hasta)
          .order('fecha', { ascending: false });
        if (clienteFiltro) q = q.eq('cliente_id', clienteFiltro);
        return q;
      });

  const [
    { data: modulos, error: modErr },
    { data, error },
    { data: pagosSinRecibo, error: psrErr },
    { data: pagosCuentaCorriente, error: pccErr },
  ] = await Promise.all([
    session.supabase.from('modulo_config').select('facturador_simple').maybeSingle(),
    fetchAllRows(buildRecibosQuery),
    fetchAllRows(buildCobranzaQuery),
    qPagoCcExec,
  ]);

  if (modErr) return NextResponse.json({ error: modErr.message }, { status: 500 });
  if (!modulos?.facturador_simple) {
    return NextResponse.json(
      { error: 'Los reportes no están habilitados para tu plan.' },
      { status: 403 },
    );
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (psrErr) return NextResponse.json({ error: psrErr.message }, { status: 500 });
  if (pccErr) return NextResponse.json({ error: pccErr.message }, { status: 500 });

  type OrigenFila = 'recibo' | 'cobranza_sin_recibo' | 'cuenta_corriente';

  type ItemRow = {
    id: string;
    fecha: string;
    numero: number | null;
    total: number;
    metodo_pago: string;
    cliente_nombre: string;
    /** Cobro de cobranza sin comprobante recibo, o pago libre desde cuenta corriente. */
    sin_comprobante_recibo?: boolean;
    origen: OrigenFila;
  };

  const desdeItems: ItemRow[] = (data ?? []).map((r) => {
    const cliente = Array.isArray(r.cliente) ? r.cliente[0] : r.cliente;
    return {
      id: r.id,
      fecha: r.fecha,
      numero: Number(r.numero),
      total: round2(Number(r.total)),
      metodo_pago: r.metodo_pago || 'Sin especificar',
      cliente_nombre: cliente?.nombre ?? 'Sin cliente',
      origen: 'recibo' as const,
    };
  });

  type CobranzaPagoRow = {
    id: string;
    fecha: string;
    monto: number;
    tipo_pago: TipoPago;
    cobranza_factura:
      | { cliente: { nombre: string } | { nombre: string }[] | null }
      | { cliente: { nombre: string } | { nombre: string }[] | null }[]
      | null;
  };

  const pagoRows = (pagosSinRecibo ?? []) as unknown as CobranzaPagoRow[];

  const desdePagos: ItemRow[] = pagoRows.map((r) => {
    const cf = Array.isArray(r.cobranza_factura) ? r.cobranza_factura[0] : r.cobranza_factura;
    const cliRaw = cf?.cliente;
    const cli = Array.isArray(cliRaw) ? cliRaw[0] : cliRaw;
    return {
      id: `pago-${r.id}`,
      fecha: r.fecha,
      numero: null,
      total: round2(Number(r.monto)),
      metodo_pago: etiquetaTipoPago(r.tipo_pago),
      cliente_nombre: cli?.nombre ?? 'Sin cliente',
      sin_comprobante_recibo: true,
      origen: 'cobranza_sin_recibo' as const,
    };
  });

  type PagoCcRow = {
    id: string;
    fecha: string;
    monto: number;
    tipo_pago: TipoPago;
    referencia: string | null;
    cliente: { nombre: string } | { nombre: string }[] | null;
  };

  const ccRows = (pagosCuentaCorriente ?? []) as unknown as PagoCcRow[];

  const desdePagosCc: ItemRow[] = ccRows.map((r) => {
    const cliRaw = r.cliente;
    const cli = Array.isArray(cliRaw) ? cliRaw[0] : cliRaw;
    const base = etiquetaTipoPago(r.tipo_pago);
    const ref = r.referencia?.trim();
    const metodo = ref ? `${base} · Ref. ${ref.slice(0, 40)}` : base;
    return {
      id: `cc-${r.id}`,
      fecha: r.fecha,
      numero: null,
      total: round2(Number(r.monto)),
      metodo_pago: metodo,
      cliente_nombre: cli?.nombre ?? 'Sin cliente',
      sin_comprobante_recibo: true,
      origen: 'cuenta_corriente' as const,
    };
  });

  const items = [...desdeItems, ...desdePagos, ...desdePagosCc].sort((a, b) => {
    const d = String(b.fecha).localeCompare(String(a.fecha));
    if (d !== 0) return d;
    return (b.numero ?? 0) - (a.numero ?? 0);
  });

  const totalMonto = round2(items.reduce((acc, it) => acc + it.total, 0));
  const promedio = items.length > 0 ? round2(totalMonto / items.length) : 0;
  const sinCliente = items.filter((it) => it.cliente_nombre === 'Sin cliente').length;
  const cobranzaSinRecibo = desdePagos.length;
  const pagosCcLibres = desdePagosCc.length;
  const cobrosSinRecibo = cobranzaSinRecibo + pagosCcLibres;

  if (exportFmt === 'csv') {
    const lines = [
      'fecha,numero,cliente,metodo_pago,total,sin_comprobante_recibo,origen',
      ...items.map((it) =>
        [
          csvEscape(it.fecha),
          csvEscape(it.numero ?? ''),
          csvEscape(it.cliente_nombre),
          csvEscape(it.metodo_pago),
          csvEscape(it.total),
          csvEscape(it.sin_comprobante_recibo ? 'si' : 'no'),
          csvEscape(it.origen),
        ].join(','),
      ),
    ];
    return new Response(lines.join('\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="reporte-recibos-${desde}-${hasta}.csv"`,
      },
    });
  }

  return NextResponse.json({
    sucursal_id: sucursalScope.sucursalId,
    periodo: { key, desde, hasta },
    filtros: { cliente_id: clienteFiltro },
    resumen: {
      cantidad: items.length,
      total_monto: totalMonto,
      promedio_monto: promedio,
      sin_cliente: sinCliente,
      cobros_sin_comprobante_recibo: cobrosSinRecibo,
      cobranza_sin_recibo_emitido: cobranzaSinRecibo,
      pagos_cuenta_corriente_libres: pagosCcLibres,
    },
    items,
  });
}
