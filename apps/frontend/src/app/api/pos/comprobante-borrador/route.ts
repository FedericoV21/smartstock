import { NextResponse } from 'next/server';

import {
  crearBorradorTicketPos,
  type CrearBorradorTicketBody,
} from '@/lib/facturacion/crear-borrador-ticket-pos';
import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';

export async function DELETE(request: Request) {
  const guard = await moduloGuard('facturador_pos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const id = new URL(request.url).searchParams.get('id')?.trim();
  const sucursalScope = await resolveAndValidateSucursalScope(
    session,
    new URL(request.url).searchParams.get('sucursal_id'),
  );
  if (!sucursalScope.ok) return sucursalScope.response;
  if (!sucursalScope.sucursalId) {
    return NextResponse.json({ error: 'No hay sucursal operativa seleccionada.' }, { status: 400 });
  }
  if (!id) {
    return NextResponse.json({ error: 'id requerido' }, { status: 400 });
  }

  const { data: comp, error: qErr } = await session.supabase
    .from('comprobante')
    .select('id, tenant_id, sucursal_id, estado, mp_point_intent_id')
    .eq('id', id)
    .maybeSingle();

  if (qErr || !comp || comp.tenant_id !== session.tenantId || comp.sucursal_id !== sucursalScope.sucursalId) {
    return NextResponse.json({ error: 'Comprobante no encontrado' }, { status: 404 });
  }

  if (comp.estado !== 'borrador') {
    if (comp.estado === 'pendiente_qr') {
      return NextResponse.json(
        { error: 'Hay un cobro QR en curso. Cancelalo antes de eliminar el borrador.' },
        { status: 409 },
      );
    }
    if (comp.estado === 'pendiente_transferencia_mp') {
      return NextResponse.json(
        { error: 'Hay una verificacion de Transferencia MP en curso. Cancelala antes de eliminar el borrador.' },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: 'Solo se puede eliminar un borrador sin emitir' },
      { status: 400 },
    );
  }

  if (comp.mp_point_intent_id) {
    return NextResponse.json(
      { error: 'Hay un cobro pendiente en terminal. Cancelalo antes.' },
      { status: 409 },
    );
  }


  const { error: delItems } = await session.supabase.from('comprobante_item').delete().eq('comprobante_id', id);
  if (delItems) {
    return NextResponse.json({ error: delItems.message }, { status: 500 });
  }

  const { error: delComp } = await session.supabase.from('comprobante').delete().eq('id', id);
  if (delComp) {
    return NextResponse.json({ error: delComp.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function POST(request: Request) {
  const guard = await moduloGuard('facturador_pos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  let body: CrearBorradorTicketBody;
  try {
    body = (await request.json()) as CrearBorradorTicketBody;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const sucursalScope = await resolveAndValidateSucursalScope(
    session,
    String((body as Record<string, unknown>)?.sucursal_id ?? '').trim() || null,
  );
  if (!sucursalScope.ok) return sucursalScope.response;
  if (!sucursalScope.sucursalId) {
    return NextResponse.json({ error: 'No hay sucursal operativa seleccionada.' }, { status: 400 });
  }

  const result = await crearBorradorTicketPos(
    session.supabase,
    {
      tenantId: session.tenantId,
      userId: session.userId,
      sucursalId: sucursalScope.sucursalId,
      sinRestriccionClienteTenant: true,
    },
    body,
  );

  if (!result.ok) {
    const errStr = typeof result.error === 'string' ? result.error : '';
    if (
      result.status === 404 &&
      errStr.includes('productos') &&
      errStr.includes('encontrados')
    ) {
      console.warn(
        '[api/pos/comprobante-borrador] 404 productos (ver log detallado en crearBorradorTicketPos)',
        {
          tenantId: session.tenantId,
          userId: session.userId,
          sucursalId: sucursalScope.sucursalId,
          tipo_comprobante_pos: body.tipo_comprobante_pos,
        },
      );
    }
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ comprobante: result.comprobante }, { status: 201 });
}
