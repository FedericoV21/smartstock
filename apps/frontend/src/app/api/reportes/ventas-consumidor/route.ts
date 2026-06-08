import { NextResponse } from 'next/server';

import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession } from '@/lib/api/tenant-session';
import { horaArgentina, resolverPeriodoReporte } from '@/lib/reportes/periodos';
import { fetchAllRows } from '@/lib/supabase/fetch-all';

type FranjaKey = 'hora' | 'media_jornada';

function resolverFranja(input: string | null): FranjaKey {
  return input === 'media_jornada' ? 'media_jornada' : 'hora';
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

function labelFranjaHora(h: number): string {
  return `${String(h).padStart(2, '0')}:00`;
}

function labelMediaJornada(h: number): 'Mañana (00-11)' | 'Tarde/Noche (12-23)' {
  return h < 12 ? 'Mañana (00-11)' : 'Tarde/Noche (12-23)';
}

export async function GET(request: Request) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const sp = new URL(request.url).searchParams;
  const sucursalScope = await resolveAndValidateSucursalScope(session, sp.get('sucursal_id'));
  if (!sucursalScope.ok) return sucursalScope.response;
  const periodo = resolverPeriodoReporte(sp, { defaultKey: 'hoy' });
  const franja = resolverFranja(sp.get('franja'));
  const cajaId = (sp.get('caja_id') || '').trim();
  const usuarioId = (sp.get('usuario_id') || '').trim();
  const exportFmt = (sp.get('export') || '').toLowerCase();

  const { data: modulos, error: modErr } = await session.supabase
    .from('modulo_config')
    .select('facturador_pos')
    .maybeSingle();
  if (modErr) return NextResponse.json({ error: modErr.message }, { status: 500 });
  if (!modulos?.facturador_pos) {
    return NextResponse.json(
      { error: 'Este reporte requiere el módulo facturador_pos habilitado.' },
      { status: 403 },
    );
  }

  const buildTicketsQuery = () => {
    let query = session.supabase
      .from('comprobante')
      .select('id, numero, numero_orden, fecha, created_at, total, caja_id, usuario_id, metodo_pago, tipo, estado')
      .eq('estado', 'emitido')
      .eq('tipo', 'ticket')
      .gte('fecha', periodo.desde)
      .lte('fecha', periodo.hasta)
      .order('created_at', { ascending: false });

    if (sucursalScope.sucursalId) query = query.eq('sucursal_id', sucursalScope.sucursalId);
    if (cajaId) query = query.eq('caja_id', cajaId);
    if (usuarioId) query = query.eq('usuario_id', usuarioId);
    return query;
  };

  const { data: rows, error } = await fetchAllRows(buildTicketsQuery);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const tickets = rows ?? [];
  const totalTickets = tickets.length;
  const totalVendido = redondear2(tickets.reduce((acc, t) => acc + Number(t.total), 0));
  const ticketPromedio = totalTickets > 0 ? redondear2(totalVendido / totalTickets) : 0;
  const ordenes = new Set(tickets.map((t) => t.numero_orden)).size;

  const userIds = Array.from(
    new Set(tickets.map((t) => t.usuario_id).filter((id): id is string => Boolean(id))),
  );
  let usuarioMap = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: users, error: userErr } = await session.supabase
      .from('usuario')
      .select('id, nombre, apellido')
      .in('id', userIds);
    if (userErr) return NextResponse.json({ error: userErr.message }, { status: 500 });
    usuarioMap = new Map((users ?? []).map((u) => [u.id, `${u.nombre} ${u.apellido}`.trim()]));
  }

  const cajas = Array.from(
    new Set(tickets.map((t) => t.caja_id).filter((id): id is string => Boolean(id))),
  ).map((id) => ({ id, label: id }));
  const usuarios = Array.from(usuarioMap.entries()).map(([id, nombre]) => ({ id, nombre }));

  const dist = new Map<string, { label: string; tickets: number; total: number }>();
  for (const t of tickets) {
    const hour = horaArgentina(t.created_at) ?? 0;
    const label = franja === 'hora' ? labelFranjaHora(hour) : labelMediaJornada(hour);
    const prev = dist.get(label) ?? { label, tickets: 0, total: 0 };
    prev.tickets += 1;
    prev.total += Number(t.total);
    dist.set(label, prev);
  }
  const distribucion = Array.from(dist.values())
    .map((it) => ({ ...it, total: redondear2(it.total) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const detalle = tickets.map((t) => ({
    id: t.id,
    numero: t.numero,
    numero_orden: t.numero_orden,
    fecha: t.fecha,
    created_at: t.created_at,
    total: Number(t.total),
    caja_id: t.caja_id,
    usuario_id: t.usuario_id,
    usuario_nombre: t.usuario_id ? usuarioMap.get(t.usuario_id) ?? t.usuario_id : null,
    metodo_pago: t.metodo_pago,
  }));

  if (exportFmt === 'csv') {
    const lines = [
      'fecha,numero_ticket,numero_orden,caja_id,usuario,metodo_pago,total',
      ...detalle.map((it) =>
        [
          csvEscape(it.fecha),
          csvEscape(it.numero ?? ''),
          csvEscape(it.numero_orden),
          csvEscape(it.caja_id ?? ''),
          csvEscape(it.usuario_nombre ?? it.usuario_id ?? ''),
          csvEscape(it.metodo_pago ?? ''),
          csvEscape(redondear2(Number(it.total))),
        ].join(','),
      ),
    ];
    return new Response(lines.join('\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="reporte-ventas-consumidor-${periodo.desde}-${periodo.hasta}.csv"`,
      },
    });
  }

  return NextResponse.json({
    sucursal_id: sucursalScope.sucursalId,
    periodo,
    filtros: { caja_id: cajaId || null, usuario_id: usuarioId || null, franja },
    indicadores: {
      total_tickets: totalTickets,
      total_vendido: totalVendido,
      ticket_promedio: ticketPromedio,
      total_ordenes: ordenes,
    },
    distribucion,
    detalle,
    opciones: { cajas, usuarios },
  });
}
