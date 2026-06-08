import { NextResponse } from 'next/server';

import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession } from '@/lib/api/tenant-session';
import { diasEntreYmd, fechaYmdDesdeApiArgentina, ymdArgentina } from '@/lib/reportes/periodos';
import { fetchAllRows } from '@/lib/supabase/fetch-all';

type EstadoCuentaCliente = 'al_dia' | 'con_deuda' | 'vencido' | 'saldo_a_favor';
type EstadoFiltro = 'todos' | EstadoCuentaCliente;

function normalizarEstado(input: string | null): EstadoFiltro {
  switch ((input || '').toLowerCase()) {
    case 'al_dia':
      return 'al_dia';
    case 'con_deuda':
      return 'con_deuda';
    case 'vencido':
      return 'vencido';
    case 'saldo_a_favor':
      return 'saldo_a_favor';
    default:
      return 'todos';
  }
}

function diasAtraso(vencimientoAt: string, hoyYmd: string): number {
  const vencYmd = fechaYmdDesdeApiArgentina(vencimientoAt);
  if (!vencYmd) return 0;
  return diasEntreYmd(vencYmd, hoyYmd);
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
  const estado = normalizarEstado(sp.get('estado'));
  const exportFmt = (sp.get('export') || '').toLowerCase();
  const sid = sucursalScope.sucursalId;

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

  const hoyYmd = ymdArgentina();
  const porCliente = new Map<
    string,
    {
      cliente_id: string;
      cliente_nombre: string;
      saldo_total: number;
      estado: EstadoCuentaCliente;
      aging_0_30: number;
      aging_31_60: number;
      aging_61_plus: number;
      facturas_abiertas: number;
      facturas_vencidas: number;
      ultimo_vencimiento_at: string | null;
    }
  >();

  if (sid) {
    const { data: cobRows, error: cobErr } = await fetchAllRows(() =>
      session.supabase
        .from('cobranza_factura')
        .select(
          `
        cliente_id,
        saldo_pendiente,
        vencimiento_at,
        comprobante:comprobante_id!inner ( sucursal_id ),
        cliente:cliente_id ( id, nombre, razon_social )
      `,
        )
        .eq('comprobante.sucursal_id', sid)
        .gt('saldo_pendiente', 0),
    );

    if (cobErr) {
      return NextResponse.json({ error: cobErr.message }, { status: 500 });
    }

    for (const row of cobRows ?? []) {
      const cli = Array.isArray(row.cliente) ? row.cliente[0] : row.cliente;
      if (!cli || !row.cliente_id) continue;
      const nombre = cli.razon_social || cli.nombre;
      let acc = porCliente.get(row.cliente_id);
      if (!acc) {
        acc = {
          cliente_id: row.cliente_id,
          cliente_nombre: nombre,
          saldo_total: 0,
          estado: 'al_dia',
          aging_0_30: 0,
          aging_31_60: 0,
          aging_61_plus: 0,
          facturas_abiertas: 0,
          facturas_vencidas: 0,
          ultimo_vencimiento_at: null,
        };
        porCliente.set(row.cliente_id, acc);
      }
      const saldo = Number(row.saldo_pendiente);
      acc.saldo_total += saldo;
      const atraso = diasAtraso(row.vencimiento_at, hoyYmd);
      acc.facturas_abiertas += 1;
      if (atraso > 0) acc.facturas_vencidas += 1;
      if (atraso <= 30) acc.aging_0_30 += saldo;
      else if (atraso <= 60) acc.aging_31_60 += saldo;
      else acc.aging_61_plus += saldo;
      if (!acc.ultimo_vencimiento_at || row.vencimiento_at > acc.ultimo_vencimiento_at) {
        acc.ultimo_vencimiento_at = row.vencimiento_at;
      }
    }
  } else {
    const { data: clientesRows, error: ccErr } = await fetchAllRows(() =>
      session.supabase
        .from('cuenta_corriente')
        .select('cliente_id, saldo, cliente:cliente_id(id, nombre, razon_social)')
        .order('saldo', { ascending: false }),
    );

    if (ccErr) {
      return NextResponse.json({ error: ccErr.message }, { status: 500 });
    }

    for (const row of clientesRows ?? []) {
      const cli = Array.isArray(row.cliente) ? row.cliente[0] : row.cliente;
      if (!cli || !row.cliente_id) continue;
      porCliente.set(row.cliente_id, {
        cliente_id: row.cliente_id,
        cliente_nombre: cli.razon_social || cli.nombre,
        saldo_total: Number(row.saldo),
        estado: Number(row.saldo) > 0 ? 'con_deuda' : 'al_dia',
        aging_0_30: 0,
        aging_31_60: 0,
        aging_61_plus: 0,
        facturas_abiertas: 0,
        facturas_vencidas: 0,
        ultimo_vencimiento_at: null,
      });
    }

    if (modulos.facturador_simple) {
      const { data: cobRows, error: cobErr } = await fetchAllRows(() =>
        session.supabase
          .from('cobranza_factura')
          .select('cliente_id, saldo_pendiente, vencimiento_at')
          .gt('saldo_pendiente', 0),
      );

      if (cobErr) {
        return NextResponse.json({ error: cobErr.message }, { status: 500 });
      }

      for (const row of cobRows ?? []) {
        const acc = porCliente.get(row.cliente_id);
        if (!acc) continue;

        const saldo = Number(row.saldo_pendiente);
        const atraso = diasAtraso(row.vencimiento_at, hoyYmd);
        acc.facturas_abiertas += 1;
        if (atraso > 0) acc.facturas_vencidas += 1;

        if (atraso <= 30) acc.aging_0_30 += saldo;
        else if (atraso <= 60) acc.aging_31_60 += saldo;
        else acc.aging_61_plus += saldo;

        if (!acc.ultimo_vencimiento_at || row.vencimiento_at > acc.ultimo_vencimiento_at) {
          acc.ultimo_vencimiento_at = row.vencimiento_at;
        }
      }
    }
  }

  for (const acc of porCliente.values()) {
    if (acc.saldo_total < -0.01) {
      acc.estado = 'saldo_a_favor';
    } else if (acc.saldo_total <= 0.01) {
      acc.estado = 'al_dia';
    } else if (acc.facturas_vencidas > 0) {
      acc.estado = 'vencido';
    } else {
      acc.estado = 'con_deuda';
    }
    acc.saldo_total = redondear2(acc.saldo_total);
    acc.aging_0_30 = redondear2(acc.aging_0_30);
    acc.aging_31_60 = redondear2(acc.aging_31_60);
    acc.aging_61_plus = redondear2(acc.aging_61_plus);
  }

  const items = Array.from(porCliente.values())
    .filter((it) => {
      if (estado === 'todos') return true;
      return it.estado === estado;
    })
    .sort((a, b) => b.saldo_total - a.saldo_total);

  const resumen = {
    deuda_total: redondear2(
      items.reduce((acc, it) => acc + (it.saldo_total > 0 ? it.saldo_total : 0), 0),
    ),
    clientes_deudores: items.filter((it) => it.saldo_total > 0).length,
    vencidos: items.filter((it) => it.estado === 'vencido').length,
    saldo_a_favor_total: redondear2(
      items.reduce((acc, it) => acc + (it.saldo_total < 0 ? Math.abs(it.saldo_total) : 0), 0),
    ),
    clientes_con_saldo_a_favor: items.filter((it) => it.saldo_total < 0).length,
  };

  if (exportFmt === 'csv') {
    const lines = [
      'cliente,estado,saldo,aging_0_30,aging_31_60,aging_61_plus,facturas_abiertas,facturas_vencidas',
      ...items.map((it) =>
        [
          csvEscape(it.cliente_nombre),
          csvEscape(it.estado),
          csvEscape(it.saldo_total),
          csvEscape(it.aging_0_30),
          csvEscape(it.aging_31_60),
          csvEscape(it.aging_61_plus),
          csvEscape(it.facturas_abiertas),
          csvEscape(it.facturas_vencidas),
        ].join(','),
      ),
    ];
    return new Response(lines.join('\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="reporte-clientes-deuda-${estado}.csv"`,
      },
    });
  }

  return NextResponse.json({ sucursal_id: sucursalScope.sucursalId, items, resumen });
}
