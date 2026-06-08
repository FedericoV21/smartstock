import { NextResponse, type NextRequest } from 'next/server';

import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';
import { UUID_RE, parseFechaYmd, parseHoraReq, parseObject, strOrNull } from '@/lib/turnos/api';
import {
  addDaysYmd,
  minutesToTime,
  rangeDurationMinutes,
  reservasFijasParaFecha,
  timeToMinutes,
  turnosOverlap,
  type ReservaFijaTurno,
} from '@/lib/turnos/slots';

async function parseJson(request: Request): Promise<Record<string, unknown> | NextResponse> {
  try {
    return parseObject(await request.json());
  } catch {
    return NextResponse.json({ error: 'JSON invalido' }, { status: 400 });
  }
}

export async function GET(request: NextRequest) {
  const guard = await moduloGuard('turnos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const sp = new URL(request.url).searchParams;
  const scope = await resolveAndValidateSucursalScope(session, sp.get('sucursal_id'));
  if (!scope.ok) return scope.response;
  if (!scope.sucursalId) {
    return NextResponse.json({ error: 'No hay sucursal operativa seleccionada.' }, { status: 400 });
  }

  const agendaId = sp.get('agenda_id')?.trim() ?? '';
  const desde = parseFechaYmd(sp.get('desde'));
  const hasta = parseFechaYmd(sp.get('hasta')) ?? desde;
  if (!UUID_RE.test(agendaId) || !desde || !hasta) {
    return NextResponse.json({ error: 'agenda_id, desde y hasta son requeridos' }, { status: 400 });
  }

  const db = session.supabase as any;
  const { data: agenda, error: agendaErr } = await db
    .from('turno_agenda')
    .select('id')
    .eq('id', agendaId)
    .eq('tenant_id', session.tenantId)
    .eq('sucursal_id', scope.sucursalId)
    .maybeSingle();
  if (agendaErr) return NextResponse.json({ error: agendaErr.message }, { status: 500 });
  if (!agenda) return NextResponse.json({ error: 'Agenda no encontrada' }, { status: 404 });

  const { data, error } = await db
    .from('turno_bloqueo')
    .select('*')
    .eq('tenant_id', session.tenantId)
    .eq('agenda_id', agendaId)
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .order('fecha', { ascending: true })
    .order('hora_inicio', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ bloqueos: data ?? [], sucursal_id: scope.sucursalId });
}

export async function POST(request: Request) {
  const guard = await moduloGuard('turnos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const scope = await resolveAndValidateSucursalScope(session, null);
  if (!scope.ok) return scope.response;
  if (!scope.sucursalId) {
    return NextResponse.json({ error: 'No hay sucursal operativa seleccionada.' }, { status: 400 });
  }

  const parsed = await parseJson(request);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;

  const agendaId = String(body.agenda_id ?? '').trim();
  const fecha = parseFechaYmd(body.fecha);
  const horaInicio = parseHoraReq(body.hora_inicio);
  if (!UUID_RE.test(agendaId) || !fecha || !horaInicio) {
    return NextResponse.json({ error: 'agenda_id, fecha y hora_inicio son requeridos' }, { status: 400 });
  }

  const db = session.supabase as any;
  const { data: agenda, error: agendaErr } = await db
    .from('turno_agenda')
    .select('id,duracion_minutos')
    .eq('id', agendaId)
    .eq('tenant_id', session.tenantId)
    .eq('sucursal_id', scope.sucursalId)
    .maybeSingle();
  if (agendaErr) return NextResponse.json({ error: agendaErr.message }, { status: 500 });
  if (!agenda) return NextResponse.json({ error: 'Agenda no encontrada' }, { status: 404 });

  const inicioMin = timeToMinutes(horaInicio);
  const horaFinBody = parseHoraReq(body.hora_fin);
  const horaFin = horaFinBody ?? (inicioMin == null ? null : minutesToTime(inicioMin + Number(agenda.duracion_minutos ?? 60)));
  if (!horaFin || inicioMin == null || rangeDurationMinutes(horaInicio, horaFin) == null) {
    return NextResponse.json({ error: 'Rango horario invalido' }, { status: 400 });
  }

  const fechaDesdeCheck = addDaysYmd(fecha, -1);
  const fechaHastaCheck = addDaysYmd(fecha, 1);
  const requested = { fecha, hora_inicio: horaInicio, hora_fin: horaFin };
  const [{ data: reservas, error: reservasErr }, { data: reservasFijas, error: reservasFijasErr }] = await Promise.all([
    db
      .from('turno_reserva')
      .select('id,fecha,hora_inicio,hora_fin,estado')
      .eq('tenant_id', session.tenantId)
      .eq('agenda_id', agendaId)
      .gte('fecha', fechaDesdeCheck)
      .lte('fecha', fechaHastaCheck)
      .neq('estado', 'cancelado'),
    db
      .from('turno_reserva_fija')
      .select('id,dia_semana,hora_inicio,hora_fin,activa,nombre')
      .eq('tenant_id', session.tenantId)
      .eq('agenda_id', agendaId)
      .eq('activa', true),
  ]);
  if (reservasErr) return NextResponse.json({ error: reservasErr.message }, { status: 500 });
  if (reservasFijasErr) return NextResponse.json({ error: reservasFijasErr.message }, { status: 500 });
  if ((reservas ?? []).some((r: { fecha: string; hora_inicio: string; hora_fin: string }) => turnosOverlap(requested, r))) {
    return NextResponse.json({ error: 'El horario tiene una reserva activa' }, { status: 409 });
  }
  if (reservasFijasParaFecha(fecha, (reservasFijas ?? []) as ReservaFijaTurno[]).some((r) => turnosOverlap(requested, r))) {
    return NextResponse.json({ error: 'El horario tiene una reserva fija activa' }, { status: 409 });
  }

  const { data: bloqueo, error } = await db
    .from('turno_bloqueo')
    .insert({
      tenant_id: session.tenantId,
      agenda_id: agendaId,
      fecha,
      hora_inicio: horaInicio,
      hora_fin: horaFin,
      motivo: strOrNull(body.motivo, 300),
      created_by: session.userId,
    })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ bloqueo }, { status: 201 });
}
