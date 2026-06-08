import { NextResponse, type NextRequest } from 'next/server';

import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';
import { UUID_RE, parseFechaYmd } from '@/lib/turnos/api';
import {
  addDaysYmd,
  generarSlotsParaFecha,
  listarFechas,
  type BloqueoTurno,
  type DisponibilidadSemanal,
  type ExtraHorarioTurno,
  type ReservaFijaTurno,
  type ReservaTurno,
} from '@/lib/turnos/slots';

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
  const fechas = listarFechas(desde, hasta, 31);
  if (fechas.length === 0) {
    return NextResponse.json({ error: 'Rango de fechas invalido' }, { status: 400 });
  }
  const desdeConsulta = addDaysYmd(desde, -1);
  const hastaConsulta = addDaysYmd(hasta, 1);

  const db = session.supabase as any;
  const { data: agenda, error: agendaErr } = await db
    .from('turno_agenda')
    .select('*')
    .eq('id', agendaId)
    .eq('tenant_id', session.tenantId)
    .eq('sucursal_id', scope.sucursalId)
    .maybeSingle();
  if (agendaErr) return NextResponse.json({ error: agendaErr.message }, { status: 500 });
  if (!agenda) return NextResponse.json({ error: 'Agenda no encontrada' }, { status: 404 });

  const [{ data: disponibilidad }, { data: bloqueos }, { data: reservas }, { data: reservasFijas }, { data: extrasHorarios }] = await Promise.all([
    db
      .from('turno_agenda_disponibilidad')
      .select('id,dia_semana,hora_inicio,hora_fin')
      .eq('tenant_id', session.tenantId)
      .eq('agenda_id', agendaId),
    db
      .from('turno_bloqueo')
      .select('*')
      .eq('tenant_id', session.tenantId)
      .eq('agenda_id', agendaId)
      .gte('fecha', desdeConsulta)
      .lte('fecha', hastaConsulta),
    db
      .from('turno_reserva')
      .select('*, cliente:cliente_id(id,nombre,razon_social,cuit_dni,telefono,email)')
      .eq('tenant_id', session.tenantId)
      .eq('agenda_id', agendaId)
      .gte('fecha', desdeConsulta)
      .lte('fecha', hastaConsulta)
      .neq('estado', 'cancelado'),
    db
      .from('turno_reserva_fija')
      .select('id,agenda_id,cliente_id,nombre,telefono,email,notas,dia_semana,hora_inicio,hora_fin,activa,cliente:cliente_id(id,nombre,razon_social,telefono,email)')
      .eq('tenant_id', session.tenantId)
      .eq('agenda_id', agendaId)
      .eq('activa', true),
    db
      .from('turno_agenda_extra_horario')
      .select('id,dia_semana,hora_inicio,hora_fin,extra_monto,descripcion,activa')
      .eq('tenant_id', session.tenantId)
      .eq('agenda_id', agendaId)
      .eq('activa', true),
  ]);

  const dispRows = (disponibilidad ?? []) as DisponibilidadSemanal[];
  const bloqueoRows = (bloqueos ?? []) as BloqueoTurno[];
  const reservaRows = (reservas ?? []) as ReservaTurno[];
  const reservaFijaRows = (reservasFijas ?? []) as ReservaFijaTurno[];
  const extrasRows = (extrasHorarios ?? []) as ExtraHorarioTurno[];

  let reservasParaSlots = reservaRows;
  let reservasFijasParaSlots = reservaFijaRows;
  if (agenda.agenda_principal_id) {
    const [{ data: reservasPrincipal }, { data: reservasFijasPrincipal }] = await Promise.all([
      db
        .from('turno_reserva')
        .select('id,fecha,hora_inicio,hora_fin,estado,nombre')
        .eq('tenant_id', session.tenantId)
        .eq('agenda_id', agenda.agenda_principal_id)
        .gte('fecha', desdeConsulta)
        .lte('fecha', hastaConsulta)
        .neq('estado', 'cancelado'),
      db
        .from('turno_reserva_fija')
        .select('id,agenda_id,cliente_id,nombre,telefono,email,notas,dia_semana,hora_inicio,hora_fin,activa')
        .eq('tenant_id', session.tenantId)
        .eq('agenda_id', agenda.agenda_principal_id)
        .eq('activa', true),
    ]);
    reservasParaSlots = [...reservaRows, ...((reservasPrincipal ?? []) as ReservaTurno[])];
    reservasFijasParaSlots = [
      ...reservaFijaRows,
      ...((reservasFijasPrincipal ?? []) as ReservaFijaTurno[]),
    ];
  }

  const slots = fechas.flatMap((fecha) =>
    generarSlotsParaFecha({
      fecha,
      duracionMinutos: Number(agenda.duracion_minutos ?? 60),
      disponibilidad: dispRows,
      bloqueos: bloqueoRows,
      reservas: reservasParaSlots,
      reservasFijas: reservasFijasParaSlots,
      extrasHorarios: extrasRows,
      precioBase: Number(agenda.precio ?? 0),
    }),
  );

  return NextResponse.json({
    agenda,
    slots,
    reservas: reservas ?? [],
    reservas_fijas: reservasFijas ?? [],
    extras_horarios: extrasHorarios ?? [],
    bloqueos: bloqueos ?? [],
    sucursal_id: scope.sucursalId,
  });
}
