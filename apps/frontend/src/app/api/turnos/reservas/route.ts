import { NextResponse, type NextRequest } from 'next/server';

import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';
import { UUID_RE, money, parseFechaYmd, parseHoraReq, parseObject, strOrNull } from '@/lib/turnos/api';
import {
  addDaysYmd,
  calcularExtraHorario,
  estaDisponible,
  minutesToTime,
  rangeDurationMinutes,
  timeToMinutes,
  type BloqueoTurno,
  type DisponibilidadSemanal,
  type ExtraHorarioTurno,
  type ReservaFijaTurno,
  type ReservaTurno,
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

  const desde = parseFechaYmd(sp.get('desde'));
  const hasta = parseFechaYmd(sp.get('hasta')) ?? desde;
  if (!desde || !hasta) {
    return NextResponse.json({ error: 'desde y hasta son requeridos' }, { status: 400 });
  }

  const agendaId = sp.get('agenda_id')?.trim() ?? '';
  const db = session.supabase as any;
  let query = db
    .from('turno_reserva')
    .select('*, agenda:turno_agenda(id,nombre,precio), cliente:cliente_id(id,nombre,razon_social,telefono,email)')
    .eq('tenant_id', session.tenantId)
    .eq('sucursal_id', scope.sucursalId)
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .order('fecha', { ascending: true })
    .order('hora_inicio', { ascending: true });

  if (agendaId) {
    if (!UUID_RE.test(agendaId)) {
      return NextResponse.json({ error: 'agenda_id invalido' }, { status: 400 });
    }
    query = query.eq('agenda_id', agendaId);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reservas: data ?? [], sucursal_id: scope.sucursalId });
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
    .select('*')
    .eq('id', agendaId)
    .eq('tenant_id', session.tenantId)
    .eq('sucursal_id', scope.sucursalId)
    .eq('activa', true)
    .maybeSingle();
  if (agendaErr) return NextResponse.json({ error: agendaErr.message }, { status: 500 });
  if (!agenda) return NextResponse.json({ error: 'Agenda no encontrada' }, { status: 404 });

  const inicioMin = timeToMinutes(horaInicio);
  const duracion = Number(agenda.duracion_minutos ?? 60);
  if (inicioMin == null || !Number.isFinite(duracion) || duracion <= 0 || duracion >= 24 * 60) {
    return NextResponse.json({ error: 'Horario invalido' }, { status: 400 });
  }
  const horaFin = minutesToTime(inicioMin + duracion);
  if (rangeDurationMinutes(horaInicio, horaFin) == null) {
    return NextResponse.json({ error: 'Horario invalido' }, { status: 400 });
  }

  const clienteIdRaw = String(body.cliente_id ?? '').trim();
  const clienteId = clienteIdRaw ? clienteIdRaw : null;
  if (clienteId && !UUID_RE.test(clienteId)) {
    return NextResponse.json({ error: 'cliente_id invalido' }, { status: 400 });
  }

  let nombre = strOrNull(body.nombre, 180);
  if (clienteId) {
    const { data: cliente, error: clienteErr } = await db
      .from('cliente')
      .select('id,nombre,razon_social,telefono,email')
      .eq('id', clienteId)
      .eq('tenant_id', session.tenantId)
      .maybeSingle();
    if (clienteErr) return NextResponse.json({ error: clienteErr.message }, { status: 500 });
    if (!cliente) return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 });
    nombre = nombre ?? cliente.razon_social ?? cliente.nombre;
  }
  if (!nombre) {
    return NextResponse.json({ error: 'El nombre de la reserva es obligatorio' }, { status: 400 });
  }

  const fechaDesdeCheck = addDaysYmd(fecha, -1);
  const fechaHastaCheck = addDaysYmd(fecha, 1);
  const [{ data: disponibilidad }, { data: bloqueos }, { data: reservas }, { data: reservasFijas }, { data: extrasHorarios }] = await Promise.all([
    db
      .from('turno_agenda_disponibilidad')
      .select('id,dia_semana,hora_inicio,hora_fin')
      .eq('tenant_id', session.tenantId)
      .eq('agenda_id', agendaId),
    db
      .from('turno_bloqueo')
      .select('id,fecha,hora_inicio,hora_fin,motivo')
      .eq('tenant_id', session.tenantId)
      .eq('agenda_id', agendaId)
      .gte('fecha', fechaDesdeCheck)
      .lte('fecha', fechaHastaCheck),
    db
      .from('turno_reserva')
      .select('id,fecha,hora_inicio,hora_fin,estado,nombre')
      .eq('tenant_id', session.tenantId)
      .eq('agenda_id', agendaId)
      .gte('fecha', fechaDesdeCheck)
      .lte('fecha', fechaHastaCheck)
      .neq('estado', 'cancelado'),
    db
      .from('turno_reserva_fija')
      .select('id,agenda_id,dia_semana,hora_inicio,hora_fin,activa,nombre')
      .eq('tenant_id', session.tenantId)
      .eq('agenda_id', agendaId)
      .eq('activa', true),
    db
      .from('turno_agenda_extra_horario')
      .select('id,dia_semana,hora_inicio,hora_fin,extra_monto,activa')
      .eq('tenant_id', session.tenantId)
      .eq('agenda_id', agendaId)
      .eq('activa', true),
  ]);

  let reservasParaCheck = (reservas ?? []) as ReservaTurno[];
  let reservasFijasParaCheck = (reservasFijas ?? []) as ReservaFijaTurno[];
  if (agenda.agenda_principal_id) {
    const [{ data: reservasPrincipal }, { data: reservasFijasPrincipal }] = await Promise.all([
      db
        .from('turno_reserva')
        .select('id,fecha,hora_inicio,hora_fin,estado,nombre')
        .eq('tenant_id', session.tenantId)
        .eq('agenda_id', agenda.agenda_principal_id)
        .gte('fecha', fechaDesdeCheck)
        .lte('fecha', fechaHastaCheck)
        .neq('estado', 'cancelado'),
      db
        .from('turno_reserva_fija')
        .select('id,agenda_id,dia_semana,hora_inicio,hora_fin,activa,nombre')
        .eq('tenant_id', session.tenantId)
        .eq('agenda_id', agenda.agenda_principal_id)
        .eq('activa', true),
    ]);
    reservasParaCheck = [...reservasParaCheck, ...((reservasPrincipal ?? []) as ReservaTurno[])];
    reservasFijasParaCheck = [
      ...reservasFijasParaCheck,
      ...((reservasFijasPrincipal ?? []) as ReservaFijaTurno[]),
    ];
  }

  const disponible = estaDisponible({
    fecha,
    hora_inicio: horaInicio,
    hora_fin: horaFin,
    disponibilidad: (disponibilidad ?? []) as DisponibilidadSemanal[],
    bloqueos: (bloqueos ?? []) as BloqueoTurno[],
    reservas: reservasParaCheck,
    reservasFijas: reservasFijasParaCheck,
  });
  if (!disponible) {
    return NextResponse.json({ error: 'El horario ya no esta disponible' }, { status: 409 });
  }

  const extraMonto = calcularExtraHorario({
    fecha,
    hora_inicio: horaInicio,
    hora_fin: horaFin,
    extrasHorarios: (extrasHorarios ?? []) as ExtraHorarioTurno[],
  });
  const precioSnapshot = Math.round((Number(agenda.precio ?? 0) + extraMonto) * 100) / 100;
  const senaMonto = money(body.sena_monto);
  if (senaMonto > precioSnapshot) {
    return NextResponse.json(
      { error: 'La seña no puede superar el precio de la reserva' },
      { status: 400 },
    );
  }

  const { data: reserva, error } = await db
    .from('turno_reserva')
    .insert({
      tenant_id: session.tenantId,
      sucursal_id: scope.sucursalId,
      agenda_id: agendaId,
      cliente_id: clienteId,
      nombre,
      telefono: strOrNull(body.telefono, 80),
      email: strOrNull(body.email, 120),
      notas: strOrNull(body.notas, 1000),
      fecha,
      hora_inicio: horaInicio,
      hora_fin: horaFin,
      precio_snapshot: precioSnapshot,
      sena_monto: senaMonto,
      estado: 'reservado',
      created_by: session.userId,
    })
    .select('*, agenda:turno_agenda(id,nombre,precio), cliente:cliente_id(id,nombre,razon_social,telefono,email)')
    .single();

  if (error) {
    const msg = error.message ?? '';
    const conflict = error.code === '23505' || msg.includes('uq_turno_reserva_slot_activo');
    return NextResponse.json(
      { error: conflict ? 'El horario ya fue reservado' : msg },
      { status: conflict ? 409 : 400 },
    );
  }

  return NextResponse.json({ reserva }, { status: 201 });
}
