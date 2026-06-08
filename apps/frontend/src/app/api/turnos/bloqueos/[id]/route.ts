import { NextResponse } from 'next/server';

import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';
import { UUID_RE } from '@/lib/turnos/api';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Bloqueo invalido' }, { status: 400 });

  const db = session.supabase as any;
  const { data: bloqueo, error: bloqueoErr } = await db
    .from('turno_bloqueo')
    .select('id,agenda_id')
    .eq('id', id)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();
  if (bloqueoErr) return NextResponse.json({ error: bloqueoErr.message }, { status: 500 });
  if (!bloqueo) return NextResponse.json({ error: 'Bloqueo no encontrado' }, { status: 404 });

  const { data: agenda, error: agendaErr } = await db
    .from('turno_agenda')
    .select('id')
    .eq('id', bloqueo.agenda_id)
    .eq('tenant_id', session.tenantId)
    .eq('sucursal_id', scope.sucursalId)
    .maybeSingle();
  if (agendaErr) return NextResponse.json({ error: agendaErr.message }, { status: 500 });
  if (!agenda) return NextResponse.json({ error: 'Agenda no encontrada' }, { status: 404 });

  const { error } = await db
    .from('turno_bloqueo')
    .delete()
    .eq('id', id)
    .eq('tenant_id', session.tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
