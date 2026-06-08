import { NextResponse } from 'next/server';

import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';
import { UUID_RE, money, parseObject, strOrNull } from '@/lib/turnos/api';

async function parseJson(request: Request): Promise<Record<string, unknown> | NextResponse> {
  try {
    return parseObject(await request.json());
  } catch {
    return NextResponse.json({ error: 'JSON invalido' }, { status: 400 });
  }
}

export async function PATCH(
  request: Request,
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

  const parsed = await parseJson(request);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;

  const db = session.supabase as any;
  const updates: Record<string, unknown> = {};
  if (body.nombre !== undefined) {
    const nombre = strOrNull(body.nombre, 180);
    if (!nombre) return NextResponse.json({ error: 'El nombre de la reserva es obligatorio' }, { status: 400 });
    updates.nombre = nombre;
  }
  if (body.telefono !== undefined) updates.telefono = strOrNull(body.telefono, 80);
  if (body.email !== undefined) updates.email = strOrNull(body.email, 120);
  if (body.notas !== undefined) updates.notas = strOrNull(body.notas, 1000);
  if (body.sena_monto !== undefined) updates.sena_monto = money(body.sena_monto);

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No hay cambios para guardar' }, { status: 400 });
  }

  const { data: reserva, error } = await db
    .from('turno_reserva')
    .update(updates)
    .eq('id', id)
    .eq('tenant_id', session.tenantId)
    .eq('sucursal_id', scope.sucursalId)
    .eq('estado', 'reservado')
    .select('*, agenda:turno_agenda(id,nombre,precio), cliente:cliente_id(id,nombre,razon_social,telefono,email)')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!reserva) {
    return NextResponse.json({ error: 'La reserva no existe o no se puede editar' }, { status: 404 });
  }
  return NextResponse.json({ reserva });
}
