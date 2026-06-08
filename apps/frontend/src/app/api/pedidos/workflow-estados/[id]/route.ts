import { NextResponse } from 'next/server';

import { hasPermission } from '@/lib/api/permissions';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { normalizeWorkflowHexColor } from '@/lib/colors/workflow-hex';
import { moduloGuard } from '@/lib/modulos/guard';
import type { Database } from '@/types/database';

type EstadoPedido = Database['public']['Enums']['estado_pedido'];
type PedidoEstadoWorkflowUpdate = Database['public']['Tables']['pedido_estado_workflow']['Update'];

function isEstadoPedido(v: string): v is EstadoPedido {
  return v === 'borrador' || v === 'confirmado' || v === 'entregado' || v === 'cancelado';
}

async function requireAdminPedidos(session: Exclude<Awaited<ReturnType<typeof getTenantSession>>, { error: NextResponse }>) {
  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const canManage = await hasPermission(session.supabase, 'pedidos.gestionar', {
    rol: session.rol,
    isSuperAdmin: session.isSuperAdmin,
  });
  const allow = session.isSuperAdmin || session.rol === 'admin' || canManage;
  if (!allow) {
    return NextResponse.json({ error: 'Solo el administrador puede configurar estados de pedidos.' }, { status: 403 });
  }
  return null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await moduloGuard('pedidos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = await requireAdminPedidos(session);
  if (forbidden) return forbidden;

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const b =
    body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};

  const patch: PedidoEstadoWorkflowUpdate = {};
  if (typeof b.slug === 'string') patch.slug = b.slug.trim();
  if (typeof b.nombre === 'string') patch.nombre = b.nombre.trim();
  if ('color' in b) {
    const cRaw = b.color;
    if (cRaw === null || cRaw === undefined) {
      patch.color = null;
    } else if (typeof cRaw === 'string' && !cRaw.trim()) {
      patch.color = null;
    } else if (typeof cRaw === 'string') {
      const normalized = normalizeWorkflowHexColor(cRaw);
      if (!normalized) {
        return NextResponse.json({ error: 'color debe ser hexadecimal #RRGGBB o vacío' }, { status: 400 });
      }
      patch.color = normalized;
    }
  }
  if (typeof b.orden !== 'undefined') patch.orden = Number(b.orden);
  if (typeof b.activo !== 'undefined') patch.activo = b.activo !== false;
  if (typeof b.fase === 'string') {
    const fase = b.fase.trim();
    if (!isEstadoPedido(fase)) return NextResponse.json({ error: 'fase inválida' }, { status: 400 });
    patch.fase = fase;
  }

  if (typeof patch.orden === 'number' && !Number.isFinite(patch.orden)) {
    return NextResponse.json({ error: 'orden inválido' }, { status: 400 });
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No hay campos para actualizar' }, { status: 400 });
  }

  const { data, error } = await session.supabase
    .from('pedido_estado_workflow')
    .update(patch)
    .eq('tenant_id', session.tenantId)
    .eq('id', id)
    .select('id, slug, nombre, color, fase, orden, activo, created_at, updated_at')
    .maybeSingle();

  if (error) {
    const status = error.code === '23505' ? 409 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
  if (!data) return NextResponse.json({ error: 'Estado workflow no encontrado' }, { status: 404 });

  return NextResponse.json({ estado: data });
}

