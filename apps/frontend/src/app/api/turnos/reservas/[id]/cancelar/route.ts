import { NextResponse } from 'next/server';

import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';
import { UUID_RE } from '@/lib/turnos/api';

export async function POST(
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
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Reserva invalida' }, { status: 400 });

  const db = session.supabase as any;
  const { data: actual, error: actualErr } = await db
    .from('turno_reserva')
    .select('id,estado')
    .eq('id', id)
    .eq('tenant_id', session.tenantId)
    .eq('sucursal_id', scope.sucursalId)
    .maybeSingle();
  if (actualErr) return NextResponse.json({ error: actualErr.message }, { status: 500 });
  if (!actual) return NextResponse.json({ error: 'Reserva no encontrada' }, { status: 404 });
  if (actual.estado === 'cobrado') {
    return NextResponse.json({ error: 'La reserva ya esta cobrada' }, { status: 409 });
  }

  const { data: reserva, error } = await db
    .from('turno_reserva')
    .update({
      estado: 'cancelado',
      cancelado_at: new Date().toISOString(),
      cancelado_por: session.userId,
    })
    .eq('id', id)
    .eq('tenant_id', session.tenantId)
    .eq('sucursal_id', scope.sucursalId)
    .neq('estado', 'cobrado')
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ reserva });
}
