import { NextResponse } from 'next/server';

import { hasPermission } from '@/lib/api/permissions';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';

async function requireAdminPedidos(session: Exclude<Awaited<ReturnType<typeof getTenantSession>>, { error: NextResponse }>) {
  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const canManage = await hasPermission(session.supabase, 'pedidos.gestionar', {
    rol: session.rol,
    isSuperAdmin: session.isSuperAdmin,
  });
  const allow = session.isSuperAdmin || session.rol === 'admin' || canManage;
  if (!allow) {
    return NextResponse.json({ error: 'Solo el administrador puede configurar transiciones de pedidos.' }, { status: 403 });
  }
  return null;
}

type Edge = { desde_id: string; hacia_id: string };

function parseEdges(v: unknown): Edge[] | null {
  if (!Array.isArray(v)) return null;
  const out: Edge[] = [];
  for (const row of v) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const r = row as Record<string, unknown>;
    const desde_id = typeof r.desde_id === 'string' ? r.desde_id.trim() : '';
    const hacia_id = typeof r.hacia_id === 'string' ? r.hacia_id.trim() : '';
    if (!desde_id || !hacia_id) return null;
    out.push({ desde_id, hacia_id });
  }
  return out;
}

/**
 * Reemplaza el set completo de transiciones del tenant.
 * Nota: no es transaccional (delete + insert). Si el insert falla, el cliente debe reintentar.
 */
export async function PUT(request: Request) {
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

  const edges = parseEdges(b.transiciones);
  if (!edges) return NextResponse.json({ error: 'transiciones inválidas' }, { status: 400 });

  const { error: delErr } = await session.supabase
    .from('pedido_estado_workflow_transicion')
    .delete()
    .eq('tenant_id', session.tenantId);

  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  if (edges.length === 0) {
    return NextResponse.json({ ok: true, transiciones: [] });
  }

  const rows = edges.map((e) => ({
    tenant_id: session.tenantId,
    desde_id: e.desde_id,
    hacia_id: e.hacia_id,
  }));

  const { data, error } = await session.supabase
    .from('pedido_estado_workflow_transicion')
    .insert(rows)
    .select('desde_id, hacia_id, created_at');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, transiciones: data ?? [] });
}

