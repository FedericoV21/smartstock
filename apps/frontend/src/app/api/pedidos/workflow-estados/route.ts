import { NextResponse, type NextRequest } from 'next/server';

import { hasPermission } from '@/lib/api/permissions';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { normalizeWorkflowHexColor } from '@/lib/colors/workflow-hex';
import { moduloGuard } from '@/lib/modulos/guard';
import type { Database } from '@/types/database';

type EstadoPedido = Database['public']['Enums']['estado_pedido'];

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

export async function GET(request: NextRequest) {
  const guard = await moduloGuard('pedidos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const { searchParams } = new URL(request.url);
  const forConfig = searchParams.get('for_config') === '1';
  if (forConfig) {
    const forbidden = await requireAdminPedidos(session);
    if (forbidden) return forbidden;
  }

  let estadosQuery = session.supabase
    .from('pedido_estado_workflow')
    .select('id, slug, nombre, color, fase, orden, activo, created_at, updated_at')
    .eq('tenant_id', session.tenantId);

  if (!forConfig) estadosQuery = estadosQuery.eq('activo', true);

  const { data: estados, error: estErr } = await estadosQuery
    .order('orden', { ascending: true })
    .order('created_at', { ascending: true });

  if (estErr) return NextResponse.json({ error: estErr.message }, { status: 500 });

  const { data: transiciones, error: trErr } = await session.supabase
    .from('pedido_estado_workflow_transicion')
    .select('desde_id, hacia_id, created_at')
    .eq('tenant_id', session.tenantId);

  if (trErr) return NextResponse.json({ error: trErr.message }, { status: 500 });

  return NextResponse.json({ estados: estados ?? [], transiciones: transiciones ?? [] });
}

export async function POST(request: Request) {
  const guard = await moduloGuard('pedidos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = await requireAdminPedidos(session);
  if (forbidden) return forbidden;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const b =
    body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};

  const slug = String(b.slug ?? '').trim();
  const nombre = String(b.nombre ?? '').trim();
  const faseRaw = String(b.fase ?? '').trim();
  let color: string | null = null;
  if (typeof b.color === 'string' && b.color.trim()) {
    const normalized = normalizeWorkflowHexColor(b.color);
    if (!normalized) {
      return NextResponse.json({ error: 'color debe ser hexadecimal #RRGGBB o vacío' }, { status: 400 });
    }
    color = normalized;
  }
  const orden = b.orden == null ? 0 : Number(b.orden);
  const activo = b.activo == null ? true : b.activo !== false;

  if (!slug) return NextResponse.json({ error: 'slug es obligatorio' }, { status: 400 });
  if (!nombre) return NextResponse.json({ error: 'nombre es obligatorio' }, { status: 400 });
  if (!isEstadoPedido(faseRaw)) return NextResponse.json({ error: 'fase inválida' }, { status: 400 });
  if (!Number.isFinite(orden)) return NextResponse.json({ error: 'orden inválido' }, { status: 400 });

  const { data, error } = await session.supabase
    .from('pedido_estado_workflow')
    .insert({
      tenant_id: session.tenantId,
      slug,
      nombre,
      color,
      fase: faseRaw,
      orden,
      activo,
    })
    .select('id, slug, nombre, color, fase, orden, activo, created_at, updated_at')
    .single();

  if (error) {
    const status = error.code === '23505' ? 409 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json({ estado: data }, { status: 201 });
}

