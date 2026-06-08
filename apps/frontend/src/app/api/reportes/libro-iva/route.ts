import { NextResponse } from 'next/server';

import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession } from '@/lib/api/tenant-session';
import { resolverPeriodoReporte } from '@/lib/reportes/periodos';
import { fetchAllRows } from '@/lib/supabase/fetch-all';
import type { Database } from '@/types/database';

type TipoComprobante = Database['public']['Enums']['tipo_comprobante'];

function csvEscape(v: string | number): string {
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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

  const sp = new URL(request.url).searchParams;
  const sucursalScope = await resolveAndValidateSucursalScope(session, sp.get('sucursal_id'));
  if (!sucursalScope.ok) return sucursalScope.response;
  const exportFmt = (sp.get('export') || '').toLowerCase();
  const { desde, hasta, key } = resolverPeriodoReporte(sp);

  const buildIvaQuery = () => {
    let q = session.supabase
      .from('comprobante')
      .select('id, fecha, numero, tipo, subtotal, iva_monto, iva_porcentaje, total')
      .eq('estado', 'emitido')
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .order('fecha', { ascending: true });
    if (sucursalScope.sucursalId) q = q.eq('sucursal_id', sucursalScope.sucursalId);
    return q;
  };

  const [{ data: modulos, error: modErr }, { data, error }] = await Promise.all([
    session.supabase.from('modulo_config').select('facturador_simple').maybeSingle(),
    fetchAllRows(buildIvaQuery),
  ]);

  if (modErr) return NextResponse.json({ error: modErr.message }, { status: 500 });
  if (!modulos?.facturador_simple) {
    return NextResponse.json(
      { error: 'Los reportes no están habilitados para tu plan.' },
      { status: 403 },
    );
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const items = (data ?? [])
    .filter((r) => esDocumentoIva(r.tipo as TipoComprobante))
    .map((r) => {
      const signo = String(r.tipo).startsWith('nota_credito_') ? -1 : 1;
      const neto = round2(Number(r.subtotal) * signo);
      const iva = round2(Number(r.iva_monto) * signo);
      const total = round2(Number(r.total) * signo);
      return {
        id: r.id,
        fecha: r.fecha,
        numero: r.numero,
        tipo: r.tipo,
        alicuota: Number(r.iva_porcentaje),
        neto,
        iva,
        total,
      };
    });

  const ivaNeto = round2(items.reduce((acc, it) => acc + it.iva, 0));
  const netoGravado = round2(items.reduce((acc, it) => acc + it.neto, 0));
  const totalComprobantes = round2(items.reduce((acc, it) => acc + it.total, 0));

  const porAlicuotaMap = new Map<number, { neto: number; iva: number; total: number }>();
  for (const it of items) {
    const prev = porAlicuotaMap.get(it.alicuota) ?? { neto: 0, iva: 0, total: 0 };
    porAlicuotaMap.set(it.alicuota, {
      neto: round2(prev.neto + it.neto),
      iva: round2(prev.iva + it.iva),
      total: round2(prev.total + it.total),
    });
  }
  const por_alicuota = Array.from(porAlicuotaMap.entries())
    .map(([alicuota, v]) => ({ alicuota, ...v }))
    .sort((a, b) => a.alicuota - b.alicuota);

  if (exportFmt === 'csv') {
    const lines = [
      'fecha,tipo,numero,alicuota,neto,iva,total',
      ...items.map((it) =>
        [
          csvEscape(it.fecha),
          csvEscape(it.tipo),
          csvEscape(it.numero ?? ''),
          csvEscape(it.alicuota),
          csvEscape(it.neto),
          csvEscape(it.iva),
          csvEscape(it.total),
        ].join(','),
      ),
    ];
    return new Response(lines.join('\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="reporte-libro-iva-${desde}-${hasta}.csv"`,
      },
    });
  }

  return NextResponse.json({
    sucursal_id: sucursalScope.sucursalId,
    periodo: { key, desde, hasta },
    resumen: {
      neto_gravado: netoGravado,
      iva_neto: ivaNeto,
      total_comprobantes: totalComprobantes,
      cantidad: items.length,
    },
    por_alicuota,
    items,
  });
}
