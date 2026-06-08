import { NextResponse } from 'next/server';

import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession, rejectIfVisor, rejectUnlessAdmin } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';
import { validateAgendaPrincipalId } from '@/lib/turnos/agenda-link';
import { money, parseDisponibilidad, parseExtrasHorarios, parseObject, strOrNull } from '@/lib/turnos/api';
import { ensureAgendaServiceProduct } from '@/lib/turnos/service-product';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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
  const { id } = await params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON invalido' }, { status: 400 });
  }
  const body = parseObject(raw);
  const db = session.supabase as any;

  const { data: actual, error: actualErr } = await db
    .from('turno_agenda')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', session.tenantId)
    .eq('sucursal_id', scope.sucursalId)
    .maybeSingle();
  if (actualErr) return NextResponse.json({ error: actualErr.message }, { status: 500 });
  if (!actual) return NextResponse.json({ error: 'Agenda no encontrada' }, { status: 404 });

  const updates: Record<string, unknown> = {};
  const nombre = body.nombre !== undefined ? strOrNull(body.nombre, 120) : null;
  if (body.nombre !== undefined) {
    if (!nombre) return NextResponse.json({ error: 'El nombre de la agenda es obligatorio' }, { status: 400 });
    updates.nombre = nombre;
  }
  if (body.descripcion !== undefined) updates.descripcion = strOrNull(body.descripcion, 500);
  if (body.precio !== undefined) updates.precio = money(body.precio);
  if (typeof body.activa === 'boolean') updates.activa = body.activa;

  let disponibilidadRows: ReturnType<typeof parseDisponibilidad> | null = null;
  if (body.disponibilidad !== undefined) {
    disponibilidadRows = parseDisponibilidad(body.disponibilidad);
    if (!disponibilidadRows.ok) return disponibilidadRows.response;
    if (disponibilidadRows.rows.length === 0) {
      return NextResponse.json({ error: 'La agenda necesita al menos un horario semanal.' }, { status: 400 });
    }
  }
  let extrasHorariosRows: ReturnType<typeof parseExtrasHorarios> | null = null;
  if (body.extras_horarios !== undefined) {
    extrasHorariosRows = parseExtrasHorarios(body.extras_horarios);
    if (!extrasHorariosRows.ok) return extrasHorariosRows.response;
  }

  if (body.agenda_principal_id !== undefined) {
    const principalCheck = await validateAgendaPrincipalId({
      db,
      tenantId: session.tenantId,
      sucursalId: scope.sucursalId,
      agendaId: id,
      agendaPrincipalIdRaw: body.agenda_principal_id,
    });
    if (!principalCheck.ok) return principalCheck.response;
    updates.agenda_principal_id = principalCheck.value;
  }

  const nextNombre = String(updates.nombre ?? actual.nombre);
  const nextPrecio = Number(updates.precio ?? actual.precio ?? 0);
  const { data: tenant } = await db
    .from('tenant')
    .select('iva_porcentaje_default')
    .eq('id', session.tenantId)
    .maybeSingle();
  const product = await ensureAgendaServiceProduct(db, {
    tenantId: session.tenantId,
    sucursalId: scope.sucursalId,
    agendaId: id,
    productoId: actual.producto_id,
    nombre: nextNombre,
    precio: nextPrecio,
    ivaPorcentaje: tenant?.iva_porcentaje_default ?? 21,
  });
  if (!product.ok) return NextResponse.json({ error: product.error }, { status: 400 });
  updates.producto_id = product.productoId;

  if (Object.keys(updates).length > 0) {
    const { error } = await db
      .from('turno_agenda')
      .update(updates)
      .eq('id', id)
      .eq('tenant_id', session.tenantId)
      .eq('sucursal_id', scope.sucursalId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (disponibilidadRows?.ok) {
    const { error: delErr } = await db
      .from('turno_agenda_disponibilidad')
      .delete()
      .eq('agenda_id', id)
      .eq('tenant_id', session.tenantId);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 400 });
    const { error: insErr } = await db.from('turno_agenda_disponibilidad').insert(
      disponibilidadRows.rows.map((r) => ({
        tenant_id: session.tenantId,
        agenda_id: id,
        ...r,
      })),
    );
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 400 });
  }
  if (extrasHorariosRows?.ok) {
    const { error: delErr } = await db
      .from('turno_agenda_extra_horario')
      .delete()
      .eq('agenda_id', id)
      .eq('tenant_id', session.tenantId);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 400 });
    if (extrasHorariosRows.rows.length > 0) {
      const { error: insErr } = await db.from('turno_agenda_extra_horario').insert(
        extrasHorariosRows.rows.map((r) => ({
          tenant_id: session.tenantId,
          agenda_id: id,
          ...r,
        })),
      );
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 400 });
    }
  }

  const { data: agenda, error: getErr } = await db
    .from('turno_agenda')
    .select(`
      *,
      disponibilidad:turno_agenda_disponibilidad(id,dia_semana,hora_inicio,hora_fin),
      extras_horarios:turno_agenda_extra_horario(id,dia_semana,hora_inicio,hora_fin,extra_monto,descripcion,activa),
      reservas_fijas:turno_reserva_fija(id,cliente_id,nombre,telefono,email,notas,dia_semana,hora_inicio,hora_fin,activa)
    `)
    .eq('id', id)
    .single();
  if (getErr) return NextResponse.json({ error: getErr.message }, { status: 500 });
  return NextResponse.json({ agenda });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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
  const { id } = await params;
  const db = session.supabase as any;
  const { error } = await db
    .from('turno_agenda')
    .update({ activa: false })
    .eq('id', id)
    .eq('tenant_id', session.tenantId)
    .eq('sucursal_id', scope.sucursalId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
