import { NextResponse, type NextRequest } from 'next/server';

import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession, rejectIfVisor, rejectUnlessAdmin } from '@/lib/api/tenant-session';
import { validateAgendaPrincipalId } from '@/lib/turnos/agenda-link';
import { money, parseDisponibilidad, parseExtrasHorarios, parseObject, strOrNull } from '@/lib/turnos/api';
import { ensureAgendaServiceProduct } from '@/lib/turnos/service-product';
import { moduloGuard } from '@/lib/modulos/guard';

export async function GET(request: NextRequest) {
  const guard = await moduloGuard('turnos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const scope = await resolveAndValidateSucursalScope(session, new URL(request.url).searchParams.get('sucursal_id'));
  if (!scope.ok) return scope.response;
  if (!scope.sucursalId) {
    return NextResponse.json({ error: 'No hay sucursal operativa seleccionada.' }, { status: 400 });
  }

  const db = session.supabase as any;
  const { data, error } = await db
    .from('turno_agenda')
    .select(`
      *,
      disponibilidad:turno_agenda_disponibilidad(id,dia_semana,hora_inicio,hora_fin),
      extras_horarios:turno_agenda_extra_horario(id,dia_semana,hora_inicio,hora_fin,extra_monto,descripcion,activa),
      reservas_fijas:turno_reserva_fija(id,cliente_id,nombre,telefono,email,notas,dia_semana,hora_inicio,hora_fin,activa)
    `)
    .eq('tenant_id', session.tenantId)
    .eq('sucursal_id', scope.sucursalId)
    .order('activa', { ascending: false })
    .order('nombre', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ agendas: data ?? [], sucursal_id: scope.sucursalId });
}

export async function POST(request: Request) {
  const guard = await moduloGuard('turnos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const forbidden = rejectIfVisor(session.rol) ?? rejectUnlessAdmin(session.rol);
  if (forbidden) return forbidden;

  const scope = await resolveAndValidateSucursalScope(session, null);
  if (!scope.ok) return scope.response;
  if (!scope.sucursalId) {
    return NextResponse.json({ error: 'No hay sucursal operativa seleccionada.' }, { status: 400 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON invalido' }, { status: 400 });
  }
  const body = parseObject(raw);
  const nombre = strOrNull(body.nombre, 120);
  if (!nombre) return NextResponse.json({ error: 'El nombre de la agenda es obligatorio' }, { status: 400 });
  const disponibilidad = parseDisponibilidad(body.disponibilidad);
  if (!disponibilidad.ok) return disponibilidad.response;
  if (disponibilidad.rows.length === 0) {
    return NextResponse.json({ error: 'La agenda necesita al menos un horario semanal.' }, { status: 400 });
  }
  const extrasHorarios = parseExtrasHorarios(body.extras_horarios ?? []);
  if (!extrasHorarios.ok) return extrasHorarios.response;

  const db = session.supabase as any;
  const precio = money(body.precio);
  const principalCheck = await validateAgendaPrincipalId({
    db,
    tenantId: session.tenantId,
    sucursalId: scope.sucursalId,
    agendaId: null,
    agendaPrincipalIdRaw: body.agenda_principal_id,
  });
  if (!principalCheck.ok) return principalCheck.response;
  const { data: agenda, error } = await db
    .from('turno_agenda')
    .insert({
      tenant_id: session.tenantId,
      sucursal_id: scope.sucursalId,
      nombre,
      descripcion: strOrNull(body.descripcion, 500),
      precio,
      duracion_minutos: 60,
      activa: body.activa !== false,
      agenda_principal_id: principalCheck.value,
    })
    .select('*')
    .single();
  if (error || !agenda?.id) {
    return NextResponse.json({ error: error?.message ?? 'No se pudo crear la agenda' }, { status: 400 });
  }

  const { data: tenant } = await db
    .from('tenant')
    .select('iva_porcentaje_default')
    .eq('id', session.tenantId)
    .maybeSingle();
  const product = await ensureAgendaServiceProduct(db, {
    tenantId: session.tenantId,
    sucursalId: scope.sucursalId,
    agendaId: agenda.id,
    nombre,
    precio,
    ivaPorcentaje: tenant?.iva_porcentaje_default ?? 21,
  });
  if (!product.ok) {
    await db.from('turno_agenda').delete().eq('id', agenda.id).eq('tenant_id', session.tenantId);
    return NextResponse.json({ error: product.error }, { status: 400 });
  }

  await db
    .from('turno_agenda')
    .update({ producto_id: product.productoId })
    .eq('id', agenda.id)
    .eq('tenant_id', session.tenantId);

  const { error: dispErr } = await db.from('turno_agenda_disponibilidad').insert(
    disponibilidad.rows.map((r) => ({
      tenant_id: session.tenantId,
      agenda_id: agenda.id,
      ...r,
    })),
  );
  if (dispErr) {
    await db.from('turno_agenda').delete().eq('id', agenda.id).eq('tenant_id', session.tenantId);
    return NextResponse.json({ error: dispErr.message }, { status: 400 });
  }
  if (extrasHorarios.rows.length > 0) {
    const { error: extraErr } = await db.from('turno_agenda_extra_horario').insert(
      extrasHorarios.rows.map((r) => ({
        tenant_id: session.tenantId,
        agenda_id: agenda.id,
        ...r,
      })),
    );
    if (extraErr) {
      await db.from('turno_agenda').delete().eq('id', agenda.id).eq('tenant_id', session.tenantId);
      return NextResponse.json({ error: extraErr.message }, { status: 400 });
    }
  }

  const { data: created } = await db
    .from('turno_agenda')
    .select(`
      *,
      disponibilidad:turno_agenda_disponibilidad(id,dia_semana,hora_inicio,hora_fin),
      extras_horarios:turno_agenda_extra_horario(id,dia_semana,hora_inicio,hora_fin,extra_monto,descripcion,activa),
      reservas_fijas:turno_reserva_fija(id,cliente_id,nombre,telefono,email,notas,dia_semana,hora_inicio,hora_fin,activa)
    `)
    .eq('id', agenda.id)
    .single();

  return NextResponse.json({ agenda: created ?? { ...agenda, producto_id: product.productoId } }, { status: 201 });
}
