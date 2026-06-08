import { NextResponse } from 'next/server';

import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession } from '@/lib/api/tenant-session';
import { diasEntreYmd, resolverPeriodoReporte, sumarDiasYmd } from '@/lib/reportes/periodos';
import { fetchAllRows } from '@/lib/supabase/fetch-all';
import type { Database } from '@/types/database';

type TipoComprobante = Database['public']['Enums']['tipo_comprobante'];

function rangoPrevio(desde: string, hasta: string): { desde: string; hasta: string } {
  const dias = diasEntreYmd(desde, hasta) + 1;
  const prevHasta = sumarDiasYmd(desde, -1);
  const prevDesde = sumarDiasYmd(prevHasta, -(dias - 1));
  return { desde: prevDesde, hasta: prevHasta };
}

function esVentaOTipoAjuste(tipo: TipoComprobante): boolean {
  return tipo === 'ticket' || tipo.startsWith('factura_') || tipo.startsWith('nota_credito_');
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
  const proveedorIdFiltro = (sp.get('proveedor_id') || '').trim();
  const exportFmt = (sp.get('export') || '').toLowerCase();
  const { desde, hasta, key } = resolverPeriodoReporte(sp);
  const prev = rangoPrevio(desde, hasta);
  const sid = sucursalScope.sucursalId;

  const [{ data: modulos, error: modErr }, { data: proveedoresRows, error: provErr }] = await Promise.all([
    session.supabase
      .from('modulo_config')
      .select('facturador_simple')
      .maybeSingle(),
    fetchAllRows(() => session.supabase.from('proveedor').select('id, nombre')),
  ]);
  if (modErr) return NextResponse.json({ error: modErr.message }, { status: 500 });
  if (!modulos?.facturador_simple) {
    return NextResponse.json(
      { error: 'Los reportes no están habilitados para tu plan.' },
      { status: 403 },
    );
  }
  if (provErr) return NextResponse.json({ error: provErr.message }, { status: 500 });

  const buildItemsQuery = () => {
    let q = session.supabase
      .from('comprobante_item')
      .select(
        `
      cantidad,
      precio_costo,
      comprobante:comprobante_id!inner (fecha, estado, tipo, sucursal_id),
      producto:producto_id!inner (proveedor_id)
    `,
      )
      .eq('comprobante.estado', 'emitido')
      .gte('comprobante.fecha', prev.desde)
      .lte('comprobante.fecha', hasta);
    if (sid) q = q.eq('comprobante.sucursal_id', sid);
    return q;
  };

  const { data: itemsRows, error: itErr } = await fetchAllRows(buildItemsQuery);

  if (itErr) return NextResponse.json({ error: itErr.message }, { status: 500 });

  const nombres = new Map((proveedoresRows ?? []).map((p) => [p.id, p.nombre]));
  const actual = new Map<string, number>();
  const anterior = new Map<string, number>();

  for (const row of itemsRows ?? []) {
    const comp = Array.isArray(row.comprobante) ? row.comprobante[0] : row.comprobante;
    const prod = Array.isArray(row.producto) ? row.producto[0] : row.producto;
    if (!comp || !prod?.proveedor_id) continue;
    if (proveedorIdFiltro && prod.proveedor_id !== proveedorIdFiltro) continue;
    const tipo = comp.tipo as TipoComprobante;
    if (!esVentaOTipoAjuste(tipo)) continue;

    const costo = Number(row.precio_costo) * Number(row.cantidad);
    const signed = tipo.startsWith('nota_credito_') ? -costo : costo;
    const fecha = String(comp.fecha);
    if (fecha >= desde && fecha <= hasta) {
      actual.set(prod.proveedor_id, (actual.get(prod.proveedor_id) ?? 0) + signed);
    } else if (fecha >= prev.desde && fecha <= prev.hasta) {
      anterior.set(prod.proveedor_id, (anterior.get(prod.proveedor_id) ?? 0) + signed);
    }
  }

  const ids = new Set<string>([...actual.keys(), ...anterior.keys()]);
  const items = Array.from(ids)
    .map((id) => {
      const gastoActual = redondear2(actual.get(id) ?? 0);
      const gastoAnterior = redondear2(anterior.get(id) ?? 0);
      const variacionAbsoluta = redondear2(gastoActual - gastoAnterior);
      const variacionPct =
        gastoAnterior === 0 ? null : redondear2(((gastoActual - gastoAnterior) / gastoAnterior) * 100);
      return {
        proveedor_id: id,
        proveedor_nombre: nombres.get(id) ?? 'Proveedor',
        gasto_actual: gastoActual,
        gasto_anterior: gastoAnterior,
        variacion_abs: variacionAbsoluta,
        variacion_pct: variacionPct,
      };
    })
    .sort((a, b) => b.gasto_actual - a.gasto_actual);

  if (exportFmt === 'csv') {
    const lines = [
      'proveedor_id,proveedor,gasto_actual,gasto_anterior,variacion_abs,variacion_pct',
      ...items.map((it) =>
        [
          csvEscape(it.proveedor_id),
          csvEscape(it.proveedor_nombre),
          csvEscape(it.gasto_actual),
          csvEscape(it.gasto_anterior),
          csvEscape(it.variacion_abs),
          csvEscape(it.variacion_pct ?? ''),
        ].join(','),
      ),
    ];
    return new Response(lines.join('\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="reporte-proveedores-${desde}-${hasta}.csv"`,
      },
    });
  }

  const totalActual = redondear2(items.reduce((acc, it) => acc + it.gasto_actual, 0));
  const totalAnterior = redondear2(items.reduce((acc, it) => acc + it.gasto_anterior, 0));
  const variacionTotalAbs = redondear2(totalActual - totalAnterior);
  const variacionTotalPct =
    totalAnterior === 0 ? null : redondear2(((totalActual - totalAnterior) / totalAnterior) * 100);

  return NextResponse.json({
    sucursal_id: sucursalScope.sucursalId,
    periodo: { key, desde, hasta },
    comparativo: { desde: prev.desde, hasta: prev.hasta },
    filtro: { proveedor_id: proveedorIdFiltro || null },
    items,
    resumen: {
      total_actual: totalActual,
      total_anterior: totalAnterior,
      variacion_abs: variacionTotalAbs,
      variacion_pct: variacionTotalPct,
    },
    proveedores: (proveedoresRows ?? []).map((p) => ({ id: p.id, nombre: p.nombre })),
  });
}
