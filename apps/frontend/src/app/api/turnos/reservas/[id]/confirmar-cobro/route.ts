import { NextResponse } from 'next/server';

import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';
import { UUID_RE, parseObject } from '@/lib/turnos/api';

async function parseJson(request: Request): Promise<Record<string, unknown> | NextResponse> {
  try {
    return parseObject(await request.json());
  } catch {
    return NextResponse.json({ error: 'JSON invalido' }, { status: 400 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const turnosGuard = await moduloGuard('turnos');
  if (!turnosGuard.allowed) return turnosGuard.response;
  const posGuard = await moduloGuard('facturador_pos');
  if (!posGuard.allowed) return posGuard.response;

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
  const comprobanteId = String(parsed.comprobante_id ?? '').trim();
  if (!UUID_RE.test(comprobanteId)) {
    return NextResponse.json({ error: 'comprobante_id invalido' }, { status: 400 });
  }

  const db = session.supabase as any;
  const { data: comprobante, error: compErr } = await db
    .from('comprobante')
    .select('id,tenant_id,sucursal_id,estado')
    .eq('id', comprobanteId)
    .eq('tenant_id', session.tenantId)
    .eq('sucursal_id', scope.sucursalId)
    .maybeSingle();
  if (compErr) return NextResponse.json({ error: compErr.message }, { status: 500 });
  if (!comprobante) return NextResponse.json({ error: 'Comprobante no encontrado' }, { status: 404 });
  if (comprobante.estado === 'borrador') {
    return NextResponse.json({ error: 'El comprobante todavia no fue emitido.' }, { status: 409 });
  }

  const { data: reserva, error: updErr } = await db
    .from('turno_reserva')
    .update({ estado: 'cobrado', comprobante_id: comprobanteId })
    .eq('id', id)
    .eq('tenant_id', session.tenantId)
    .eq('sucursal_id', scope.sucursalId)
    .is('comprobante_id', null)
    .in('estado', ['reservado', 'cobrando'])
    .select('*')
    .maybeSingle();

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
  if (reserva) return NextResponse.json({ reserva });

  const { data: actual, error: actualErr } = await db
    .from('turno_reserva')
    .select('id,estado,comprobante_id')
    .eq('id', id)
    .eq('tenant_id', session.tenantId)
    .eq('sucursal_id', scope.sucursalId)
    .maybeSingle();
  if (actualErr) return NextResponse.json({ error: actualErr.message }, { status: 500 });
  if (!actual) return NextResponse.json({ error: 'Reserva no encontrada' }, { status: 404 });
  if (actual.estado === 'cobrado' && actual.comprobante_id === comprobanteId) {
    return NextResponse.json({ reserva: actual, already_linked: true });
  }

  return NextResponse.json(
    { error: 'La reserva ya fue cobrada, cancelada o vinculada a otro comprobante.' },
    { status: 409 },
  );
}
