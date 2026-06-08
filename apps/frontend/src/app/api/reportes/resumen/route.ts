import { NextResponse } from 'next/server';

import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession } from '@/lib/api/tenant-session';
import { aplanarRepresentativosVentaPorOrden } from '@/lib/facturacion/ventas-representativas-por-orden';
import { resolverPeriodoReporteConLabel } from '@/lib/reportes/periodos';
import { fetchAllRows } from '@/lib/supabase/fetch-all';
import type { Database } from '@/types/database';

type TipoComprobante = Database['public']['Enums']['tipo_comprobante'];

function esComprobanteVenta(tipo: TipoComprobante): boolean {
  return tipo.startsWith('factura_') || tipo === 'ticket';
}

function redondear2(n: number): number {
  return Math.round(n * 100) / 100;
}

function csvEscape(v: string | number): string {
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

export async function GET(request: Request) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const sp = new URL(request.url).searchParams;
  const sucursalScope = await resolveAndValidateSucursalScope(session, sp.get('sucursal_id'));
  if (!sucursalScope.ok) return sucursalScope.response;

  const { data: modulos, error: modErr } = await session.supabase
    .from('modulo_config')
    .select('facturador_simple')
    .maybeSingle();
  if (modErr) {
    return NextResponse.json({ error: modErr.message }, { status: 500 });
  }
  if (!modulos?.facturador_simple) {
    return NextResponse.json(
      { error: 'Los reportes no están habilitados para tu plan.' },
      { status: 403 },
    );
  }

  const exportFmt = (sp.get('export') || '').toLowerCase();
  const { desde, hasta, periodo, label } = resolverPeriodoReporteConLabel(sp, {
    defaultKey: 'hoy',
  });
  const sid = sucursalScope.sucursalId;

  const buildComprobantesQuery = () => {
    let q = session.supabase
      .from('comprobante')
      .select('id, total, tipo, numero_orden')
      .eq('estado', 'emitido')
      .gte('fecha', desde)
      .lte('fecha', hasta);
    if (sid) q = q.eq('sucursal_id', sid);
    return q;
  };

  const buildCostoQuery = () => {
    let q = session.supabase
      .from('comprobante_item')
      .select(
        `
        cantidad,
        precio_costo,
        comprobante:comprobante_id!inner (fecha, estado, tipo, fiscalizado_por_id, sucursal_id),
        producto:producto_id!inner (proveedor_id)
      `,
      )
      .eq('comprobante.estado', 'emitido')
      .gte('comprobante.fecha', desde)
      .lte('comprobante.fecha', hasta);
    if (sid) q = q.eq('comprobante.sucursal_id', sid);
    return q;
  };

  const [comprobantesQ, cuentaQ, costoQ] = await Promise.all([
    fetchAllRows(buildComprobantesQuery),
    fetchAllRows(() => session.supabase.from('cuenta_corriente').select('saldo').gt('saldo', 0)),
    fetchAllRows(buildCostoQuery),
  ]);

  if (comprobantesQ.error) {
    return NextResponse.json({ error: comprobantesQ.error.message }, { status: 500 });
  }
  if (cuentaQ.error) {
    return NextResponse.json({ error: cuentaQ.error.message }, { status: 500 });
  }
  if (costoQ.error) {
    return NextResponse.json({ error: costoQ.error.message }, { status: 500 });
  }

  let facturado = 0;
  let montoFacturasFiscales = 0;
  let montoTicketsPos = 0;
  let montoNotasCredito = 0;
  let comprobantesFactura = 0;
  let comprobantesTicket = 0;
  let vendidosComprobantes = 0;
  const comprobantesPeriodo = aplanarRepresentativosVentaPorOrden(comprobantesQ.data ?? []);
  for (const c of comprobantesPeriodo) {
    const tipo = c.tipo as TipoComprobante;
    const total = Number(c.total);
    if (tipo === 'presupuesto' || tipo === 'remito' || tipo === 'devolucion_remito' || tipo === 'recibo') continue;
    if (tipo.startsWith('nota_credito_')) {
      facturado -= total;
      montoNotasCredito += total;
      continue;
    }
    facturado += total;
    if (tipo.startsWith('factura_')) {
      montoFacturasFiscales += total;
      comprobantesFactura += 1;
    } else if (tipo === 'ticket') {
      montoTicketsPos += total;
      comprobantesTicket += 1;
    }
    if (esComprobanteVenta(tipo)) vendidosComprobantes += 1;
  }

  let deudaCtaCte = 0;
  for (const r of cuentaQ.data ?? []) {
    deudaCtaCte += Number(r.saldo);
  }

  const gastoPorProveedor = new Map<string, number>();
  for (const it of costoQ.data ?? []) {
    const comp = Array.isArray(it.comprobante) ? it.comprobante[0] : it.comprobante;
    const prod = Array.isArray(it.producto) ? it.producto[0] : it.producto;
    if (!comp || !prod?.proveedor_id) continue;
    const tipo = comp.tipo as TipoComprobante;
    if (
      tipo === 'ticket' &&
      (comp as { fiscalizado_por_id?: string | null }).fiscalizado_por_id
    ) {
      continue;
    }
    if (!esComprobanteVenta(tipo) && !tipo.startsWith('nota_credito_')) continue;

    const costo = Number(it.precio_costo) * Number(it.cantidad);
    const signed = tipo.startsWith('nota_credito_') ? -costo : costo;
    const prev = gastoPorProveedor.get(prod.proveedor_id) ?? 0;
    gastoPorProveedor.set(prod.proveedor_id, prev + signed);
  }

  const proveedorIds = Array.from(gastoPorProveedor.keys());
  let topProveedores: { proveedor_id: string; nombre: string; gasto: number }[] = [];
  if (proveedorIds.length > 0) {
    const { data: provRows, error: provErr } = await session.supabase
      .from('proveedor')
      .select('id, nombre')
      .in('id', proveedorIds);
    if (provErr) {
      return NextResponse.json({ error: provErr.message }, { status: 500 });
    }
    const nombres = new Map((provRows ?? []).map((p) => [p.id, p.nombre]));
    topProveedores = proveedorIds
      .map((id) => ({
        proveedor_id: id,
        nombre: nombres.get(id) ?? 'Proveedor',
        gasto: redondear2(gastoPorProveedor.get(id) ?? 0),
      }))
      .sort((a, b) => b.gasto - a.gasto)
      .slice(0, 5);
  }

  let gastoProveedores = 0;
  for (const g of gastoPorProveedor.values()) gastoProveedores += g;

  const payload = {
    sucursal_id: sucursalScope.sucursalId,
    periodo: { key: periodo, label, desde, hasta },
    kpis: {
      /** Neto: facturas fiscales + tickets POS − notas de crédito (mismo criterio que antes). */
      facturado: redondear2(facturado),
      monto_facturas_fiscales: redondear2(montoFacturasFiscales),
      monto_tickets_pos: redondear2(montoTicketsPos),
      monto_notas_credito: redondear2(montoNotasCredito),
      comprobantes_factura: comprobantesFactura,
      comprobantes_ticket: comprobantesTicket,
      vendidos_comprobantes: vendidosComprobantes,
      deuda_cta_cte: redondear2(deudaCtaCte),
      gasto_proveedores: redondear2(gastoProveedores),
    },
    top_proveedores: topProveedores,
  };

  if (exportFmt === 'csv') {
    const lines = [
      'seccion,metrica,valor',
      `kpi,facturado,${csvEscape(payload.kpis.facturado)}`,
      `kpi,monto_facturas_fiscales,${csvEscape(payload.kpis.monto_facturas_fiscales)}`,
      `kpi,monto_tickets_pos,${csvEscape(payload.kpis.monto_tickets_pos)}`,
      `kpi,monto_notas_credito,${csvEscape(payload.kpis.monto_notas_credito)}`,
      `kpi,comprobantes_factura,${csvEscape(payload.kpis.comprobantes_factura)}`,
      `kpi,comprobantes_ticket,${csvEscape(payload.kpis.comprobantes_ticket)}`,
      `kpi,vendidos_comprobantes,${csvEscape(payload.kpis.vendidos_comprobantes)}`,
      `kpi,deuda_cta_cte,${csvEscape(payload.kpis.deuda_cta_cte)}`,
      `kpi,gasto_proveedores,${csvEscape(payload.kpis.gasto_proveedores)}`,
      'top_proveedores,nombre,gasto',
      ...payload.top_proveedores.map((p) => `top_proveedores,${csvEscape(p.nombre)},${csvEscape(p.gasto)}`),
    ];
    return new Response(lines.join('\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="reporte-resumen-${desde}-${hasta}.csv"`,
      },
    });
  }

  return NextResponse.json(payload);
}
