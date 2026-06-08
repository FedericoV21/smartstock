import { NextResponse } from 'next/server';

import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession } from '@/lib/api/tenant-session';
import { aplanarRepresentativosVentaPorOrden } from '@/lib/facturacion/ventas-representativas-por-orden';
import { resolverPeriodoReporte } from '@/lib/reportes/periodos';
import { fetchAllRows } from '@/lib/supabase/fetch-all';
import type { Database } from '@/types/database';

type TipoComprobante = Database['public']['Enums']['tipo_comprobante'];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function csvEscape(v: string | number): string {
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

function esVenta(tipo: TipoComprobante): boolean {
  return tipo === 'ticket' || tipo.startsWith('factura_');
}

export async function GET(request: Request) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const sp = new URL(request.url).searchParams;
  const sucursalScope = await resolveAndValidateSucursalScope(session, sp.get('sucursal_id'));
  if (!sucursalScope.ok) return sucursalScope.response;
  const { desde, hasta, key } = resolverPeriodoReporte(sp);
  const exportFmt = (sp.get('export') || '').toLowerCase();
  const sid = sucursalScope.sucursalId;

  const buildVentasQuery = () => {
    let q = session.supabase
      .from('comprobante')
      .select('id, fecha, tipo, total, numero_orden')
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

  const [{ data: modulos, error: modErr }, comprobantesQ, costoQ] = await Promise.all([
    session.supabase.from('modulo_config').select('facturador_simple').maybeSingle(),
    fetchAllRows(buildVentasQuery),
    fetchAllRows(buildCostoQuery),
  ]);

  if (modErr) return NextResponse.json({ error: modErr.message }, { status: 500 });
  if (!modulos?.facturador_simple) {
    return NextResponse.json(
      { error: 'Los reportes no están habilitados para tu plan.' },
      { status: 403 },
    );
  }
  if (comprobantesQ.error) return NextResponse.json({ error: comprobantesQ.error.message }, { status: 500 });
  if (costoQ.error) return NextResponse.json({ error: costoQ.error.message }, { status: 500 });

  let ventasNetas = 0;
  const ventasDiarias = new Map<string, number>();
  const comprobantesNetos = aplanarRepresentativosVentaPorOrden(comprobantesQ.data ?? []);
  for (const c of comprobantesNetos) {
    const tipo = c.tipo as TipoComprobante;
    if (tipo === 'presupuesto' || tipo === 'remito' || tipo === 'devolucion_remito' || tipo === 'recibo') continue;
    const signed = tipo.startsWith('nota_credito_') ? -Number(c.total) : Number(c.total);
    if (!esVenta(tipo) && !tipo.startsWith('nota_credito_')) continue;
    ventasNetas += signed;
    ventasDiarias.set(c.fecha, (ventasDiarias.get(c.fecha) ?? 0) + signed);
  }

  let costoMercaderia = 0;
  const costoDiario = new Map<string, number>();
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
    const costo = Number(row.precio_costo) * Number(row.cantidad) * signed;
    costoMercaderia += costo;
    const fecha = String(comp.fecha);
    costoDiario.set(fecha, (costoDiario.get(fecha) ?? 0) + costo);
  }

  const margenBruto = ventasNetas - costoMercaderia;
  const margenPct = ventasNetas === 0 ? null : round2((margenBruto / ventasNetas) * 100);

  const fechas = Array.from(new Set([...ventasDiarias.keys(), ...costoDiario.keys()])).sort((a, b) =>
    a.localeCompare(b),
  );
  const serie = fechas.map((fecha) => {
    const ventas = round2(ventasDiarias.get(fecha) ?? 0);
    const costo = round2(costoDiario.get(fecha) ?? 0);
    return {
      fecha,
      ventas,
      costo,
      margen: round2(ventas - costo),
    };
  });

  if (exportFmt === 'csv') {
    const lines = [
      'fecha,ventas,costo,margen',
      ...serie.map((it) =>
        [csvEscape(it.fecha), csvEscape(it.ventas), csvEscape(it.costo), csvEscape(it.margen)].join(','),
      ),
    ];
    return new Response(lines.join('\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="reporte-ganancias-netas-${desde}-${hasta}.csv"`,
      },
    });
  }

  return NextResponse.json({
    sucursal_id: sucursalScope.sucursalId,
    periodo: { key, desde, hasta },
    resumen: {
      ventas_netas: round2(ventasNetas),
      costo_mercaderia: round2(costoMercaderia),
      margen_bruto: round2(margenBruto),
      margen_pct: margenPct,
    },
    serie,
  });
}
