import { NextResponse } from 'next/server';

import { hasPermission } from '@/lib/api/permissions';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';

async function assertCanManageUsers(
  session: Exclude<Awaited<ReturnType<typeof getTenantSession>>, { error: NextResponse }>,
) {
  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const canManageUsers = await hasPermission(session.supabase, 'usuarios.gestionar', {
    rol: session.rol,
    isSuperAdmin: session.isSuperAdmin,
  });
  const allowManageUsers = session.isSuperAdmin || session.rol === 'admin' || canManageUsers;
  if (!allowManageUsers) {
    return NextResponse.json({ error: 'Solo el administrador puede editar usuarios' }, { status: 403 });
  }
  return null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const guard = await assertCanManageUsers(session);
  if (guard) return guard;

  const { id: targetId } = await params;

  const { data: target, error: uErr } = await session.supabase
    .from('usuario')
    .select('id, rol, pedidos_puede_crear')
    .eq('id', targetId)
    .eq('tenant_id', session.tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });
  if (!target) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });

  const { data: rows, error } = await session.supabase
    .from('usuario_pedido_workflow_estado')
    .select('workflow_estado_id')
    .eq('tenant_id', session.tenantId)
    .eq('usuario_id', targetId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = [...new Set((rows ?? []).map((r) => r.workflow_estado_id).filter(Boolean))];
  return NextResponse.json({
    workflow_estado_ids: ids,
    pedidos_puede_crear: Boolean(target.pedidos_puede_crear),
    target_rol: target.rol,
  });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const guard = await assertCanManageUsers(session);
  if (guard) return guard;

  const { id: targetId } = await params;

  const { data: target, error: uErr } = await session.supabase
    .from('usuario')
    .select('id, rol, pedidos_puede_crear')
    .eq('id', targetId)
    .eq('tenant_id', session.tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });
  if (!target) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });

  if (target.rol === 'admin') {
    return NextResponse.json(
      { error: 'Los administradores siempre tienen visibilidad completa en pedidos; no aplica esta asignación.' },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const b =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const idsRaw = b.workflow_estado_ids;
  if (!Array.isArray(idsRaw)) {
    return NextResponse.json({ error: 'workflow_estado_ids debe ser un array de UUIDs' }, { status: 400 });
  }

  const uniqueIds = [...new Set(idsRaw.filter((x): x is string => typeof x === 'string' && x.trim() !== ''))];

  const pedidosPuedeCrearRaw = b.pedidos_puede_crear;
  const pedidosPuedeCrearUpdate =
    typeof pedidosPuedeCrearRaw === 'boolean' ? pedidosPuedeCrearRaw : undefined;

  if (uniqueIds.length > 0) {
    const { data: valid, error: wErr } = await session.supabase
      .from('pedido_estado_workflow')
      .select('id')
      .eq('tenant_id', session.tenantId)
      .in('id', uniqueIds);

    if (wErr) return NextResponse.json({ error: wErr.message }, { status: 500 });
    const ok = new Set((valid ?? []).map((r) => r.id));
    for (const id of uniqueIds) {
      if (!ok.has(id)) {
        return NextResponse.json({ error: `Estado de workflow inválido o de otro negocio: ${id}` }, { status: 400 });
      }
    }
  }

  const { error: delErr } = await session.supabase
    .from('usuario_pedido_workflow_estado')
    .delete()
    .eq('tenant_id', session.tenantId)
    .eq('usuario_id', targetId);

  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  if (uniqueIds.length > 0) {
    const { error: insErr } = await session.supabase.from('usuario_pedido_workflow_estado').insert(
      uniqueIds.map((workflow_estado_id) => ({
        tenant_id: session.tenantId,
        usuario_id: targetId,
        workflow_estado_id,
      })),
    );

    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  let pedidosPuedeCrearFinal = Boolean(target.pedidos_puede_crear);
  if (pedidosPuedeCrearUpdate !== undefined) {
    const { data: updated, error: upErr } = await session.supabase
      .from('usuario')
      .update({ pedidos_puede_crear: pedidosPuedeCrearUpdate })
      .eq('id', targetId)
      .eq('tenant_id', session.tenantId)
      .select('pedidos_puede_crear')
      .maybeSingle();

    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    pedidosPuedeCrearFinal = Boolean(updated?.pedidos_puede_crear);
  }

  return NextResponse.json({
    ok: true,
    workflow_estado_ids: uniqueIds,
    pedidos_puede_crear: pedidosPuedeCrearFinal,
  });
}
