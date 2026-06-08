import { NextResponse, type NextRequest } from 'next/server';

import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';
import { UUID_RE, parseHoraReq, parseObject, strOrNull } from '@/lib/turnos/api';
import {
  addDaysYmd,
  estaDisponible,
  minutesToTime,
  rangeDurationMinutes,
  timeToMinutes,
  type DisponibilidadSemanal,
  type ReservaFijaTurno,
} from '@/lib/turnos/slots';

async function parseJson(request: Request): Promise<Record<string, unknown> | NextResponse> {
  try {
    return parseObject(await request.json());
  } catch {
    return NextResponse.json({ error: 'JSON invalido' }, { status: 400 });
  }
}

function fechaReferenciaParaDia(diaSemana: number) {
  return addDaysYmd('2026-05-11', diaSemana - 1);
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
  if (!UUID_RE.test(agendaId)) {
    return NextResponse.json({ error: 'agenda_id invalido' }, { status: 400 });
  }

  const db = session.supabase as any;
  const { data, error } = await db
    .from('turno_reserva_fija')
    .select('*, cliente:cliente_id(id,nombre,razon_social,telefono,email)')
    .eq('tenant_id', session.tenantId)
    .eq('sucursal_id', scope.sucursalId)
    .eq('agenda_id', agendaId)
    .eq('activa', true)
    .order('dia_semana', { ascending: true })
    .order('hora_inicio', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reservas_fijas: data ?? [], sucursal_id: scope.sucursalId });
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
  const diaSemana = Number(body.dia_semana);
  const horaInicio = parseHoraReq(body.hora_inicio);
  if (!UUID_RE.test(agendaId) || !Number.isInteger(diaSemana) || diaSemana < 1 || diaSemana > 7 || !horaInicio) {
    return NextResponse.json({ error: 'agenda_id, dia_semana y hora_inicio son requeridos' }, { status: 400 });
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
  const horaFinBody = parseHoraReq(body.hora_fin);
  const horaFin = horaFinBody ?? (inicioMin == null ? null : minutesToTime(inicioMin + Number(agenda.duracion_minutos ?? 60)));
  if (!horaFin || inicioMin == null || rangeDurationMinutes(horaInicio, horaFin) == null) {
    return NextResponse.json({ error: 'Rango horario invalido' }, { status: 400 });
  }

  const clienteIdRaw = String(body.cliente_id ?? '').trim();
  const clienteId = clienteIdRaw ? clienteIdRaw : null;
  if (clienteId && !UUID_RE.test(clienteId)) {
    return NextResponse.json({ error: 'cliente_id invalido' }, { status: 400 });
  }

  let nombre = strOrNull(body.nombre, 180);
  let telefono = strOrNull(body.telefono, 80);
  let email = strOrNull(body.email, 120);
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
    telefono = telefono ?? cliente.telefono ?? null;
    email = email ?? cliente.email ?? null;
  }
  if (!nombre) {
    return NextResponse.json({ error: 'El nombre de la reserva fija es obligatorio' }, { status: 400 });
  }

  const [{ data: disponibilidad }, { data: reservasFijas }] = await Promise.all([
    db
      .from('turno_agenda_disponibilidad')
      .select('id,dia_semana,hora_inicio,hora_fin')
      .eq('tenant_id', session.tenantId)
      .eq('agenda_id', agendaId),
    db
      .from('turno_reserva_fija')
      .select('id,dia_semana,hora_inicio,hora_fin,activa,nombre')
      .eq('tenant_id', session.tenantId)
      .eq('agenda_id', agendaId)
      .eq('activa', true),
  ]);

  let reservasFijasParaCheck = (reservasFijas ?? []) as ReservaFijaTurno[];
  if (agenda.agenda_principal_id) {
    const { data: reservasFijasPrincipal } = await db
      .from('turno_reserva_fija')
      .select('id,dia_semana,hora_inicio,hora_fin,activa,nombre')
      .eq('tenant_id', session.tenantId)
      .eq('agenda_id', agenda.agenda_principal_id)
      .eq('activa', true);
    reservasFijasParaCheck = [
      ...reservasFijasParaCheck,
      ...((reservasFijasPrincipal ?? []) as ReservaFijaTurno[]),
    ];
  }

  const fechaReferencia = fechaReferenciaParaDia(diaSemana);
  const disponible = estaDisponible({
    fecha: fechaReferencia,
    hora_inicio: horaInicio,
    hora_fin: horaFin,
    disponibilidad: (disponibilidad ?? []) as DisponibilidadSemanal[],
    bloqueos: [],
    reservas: [],
    reservasFijas: reservasFijasParaCheck,
  });
  if (!disponible) {
    return NextResponse.json({ error: 'El horario no esta disponible para reserva fija' }, { status: 409 });
  }

  const { data: reservaFija, error } = await db
    .from('turno_reserva_fija')
    .insert({
      tenant_id: session.tenantId,
      sucursal_id: scope.sucursalId,
      agenda_id: agendaId,
      cliente_id: clienteId,
      nombre,
      telefono,
      email,
      notas: strOrNull(body.notas, 1000),
      dia_semana: diaSemana,
      hora_inicio: horaInicio,
      hora_fin: horaFin,
      activa: true,
      created_by: session.userId,
    })
    .select('*, cliente:cliente_id(id,nombre,razon_social,telefono,email)')
    .single();

  if (error) {
    const conflict = error.code === '23505' || String(error.message ?? '').includes('uq_turno_reserva_fija_slot_activo');
    return NextResponse.json(
      { error: conflict ? 'El horario ya tiene una reserva fija activa' : error.message },
      { status: conflict ? 409 : 400 },
    );
  }
  return NextResponse.json({ reserva_fija: reservaFija }, { status: 201 });
}
