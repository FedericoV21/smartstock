import { NextResponse } from 'next/server';

import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession } from '@/lib/api/tenant-session';
import { aplanarRepresentativosVentaPorOrden } from '@/lib/facturacion/ventas-representativas-por-orden';
import { resolverPeriodoReporteConLabel } from '@/lib/reportes/periodos';
import { fetchAllRows } from '@/lib/supabase/fetch-all';
import type { Database } from '@/types/database';

type TipoComprobante = Database['public']['Enums']['tipo_comprobante'];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function esComprobanteVenta(tipo: TipoComprobante): boolean {
  return tipo.startsWith('factura_') || tipo === 'ticket';
}

function esVenta(tipo: TipoComprobante): boolean {
  return tipo === 'ticket' || tipo.startsWith('factura_');
}

function esDocumentoIva(tipo: TipoComprobante): boolean {
  return (
    tipo === 'factura_a' ||
    tipo === 'factura_b' ||
    tipo === 'factura_c' ||
    tipo === 'nota_credito_a' ||
    tipo === 'nota_credito_b' ||
    tipo === 'nota_credito_c'
  );
}

export async function GET(request: Request) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  if (session.rol !== 'admin' && !session.isSuperAdmin) {
    return NextResponse.json(
      { error: 'Solo el administrador puede ver este reporte.' },
      { status: 403 },
    );
  }

  const sp = new URL(request.url).searchParams;
  const sucursalScope = await resolveAndValidateSucursalScope(session, sp.get('sucursal_id'));
  if (!sucursalScope.ok) return sucursalScope.response;

  const { desde, hasta, periodo, label } = resolverPeriodoReporteConLabel(sp, {
    defaultKey: 'hoy',
  });
  const sid = sucursalScope.sucursalId;

  const buildComprobantesQuery = () => {
    let q = session.supabase
      .from('comprobante')
      .select('id, fecha, total, tipo, numero_orden, subtotal, iva_monto')
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
        comprobante:comprobante_id!inner (fecha, tipo, estado, fiscalizado_por_id, sucursal_id)
      `,
      )
      .eq('comprobante.estado', 'emitido')
      .gte('comprobante.fecha', desde)
      .lte('comprobante.fecha', hasta);
    if (sid) q = q.eq('comprobante.sucursal_id', sid);
    return q;
  };

  const [{ data: modulos, error: modErr }, compQ, costoQ] = await Promise.all([
    session.supabase.from('modulo_config').select('facturador_simple').maybeSingle(),
    fetchAllRows(buildComprobantesQuery),
    fetchAllRows(buildCostoQuery),
  ]);

  if (modErr) return NextResponse.json({ error: modErr.message }, { status: 500 });
  if (!modulos?.facturador_simple) {
    return NextResponse.json(
      { error: 'Los reportes no están habilitados para tu plan.' },
      { status: 403 },
    );
  }
  if (compQ.error) return NextResponse.json({ error: compQ.error.message }, { status: 500 });
  if (costoQ.error) return NextResponse.json({ error: costoQ.error.message }, { status: 500 });

  const rows = compQ.data ?? [];

  let ivaPeriodo = 0;
  for (const r of rows) {
    const tipo = r.tipo as TipoComprobante;
    if (!esDocumentoIva(tipo)) continue;
    const signo = String(tipo).startsWith('nota_credito_') ? -1 : 1;
    ivaPeriodo += Number(r.iva_monto) * signo;
  }
  ivaPeriodo = round2(ivaPeriodo);

  let facturado = 0;
  let montoNotasCredito = 0;
  let vendidosComprobantes = 0;
  const aplastado = aplanarRepresentativosVentaPorOrden(rows);

  for (const c of aplastado) {
    const tipo = c.tipo as TipoComprobante;
    const total = Number(c.total);
    if (tipo === 'presupuesto' || tipo === 'remito' || tipo === 'devolucion_remito' || tipo === 'recibo') continue;
    if (tipo.startsWith('nota_credito_')) {
      facturado -= total;
      montoNotasCredito += total;
      continue;
    }
    facturado += total;
    if (esComprobanteVenta(tipo)) vendidosComprobantes += 1;
  }

  let ventasNetas = 0;
  for (const c of aplastado) {
    const tipo = c.tipo as TipoComprobante;
    if (tipo === 'presupuesto' || tipo === 'remito' || tipo === 'devolucion_remito' || tipo === 'recibo') continue;
    const signed = tipo.startsWith('nota_credito_') ? -Number(c.total) : Number(c.total);
    if (!esVenta(tipo) && !tipo.startsWith('nota_credito_')) continue;
    ventasNetas += signed;
  }

  let costoMercaderia = 0;
  for (const row of costoQ.data ?? []) {
    const comp = Array.isArray(row.comprobante) ? row.comprobante[0] : row.comprobante;
    if (!comp) continue;
    const tipo = comp.tipo as TipoComprobante;
    if (
      tipo === 'ticket' &&
      (comp as { fiscalizado_por_id?: string | null }).fiscalizado_por_id
    ) {
      continue;
    }
    if (!esVenta(tipo) && !tipo.startsWith('nota_credito_')) continue;
    const signed = tipo.startsWith('nota_credito_') ? -1 : 1;
    costoMercaderia += Number(row.precio_costo) * Number(row.cantidad) * signed;
  }

  const margenBruto = ventasNetas - costoMercaderia;

  return NextResponse.json({
    sucursal_id: sucursalScope.sucursalId,
    periodo: { key: periodo, label, desde, hasta },
    resumen: {
      ventas: round2(facturado),
      devoluciones: round2(montoNotasCredito),
      costos: round2(costoMercaderia),
      iva: ivaPeriodo,
      ganancia: round2(margenBruto),
      facturas_emitidas: vendidosComprobantes,
    },
  });
}
