import type { TenantSession } from '@/lib/api/tenant-session';

import { logPedidosDiag, shortenId } from '@/lib/pedidos/debug-log';

/**
 * Lista de IDs de `pedido_estado_workflow` que el usuario puede ver en pedidos,
 * o `null` cuando no debe aplicarse filtro (sin asignaciones, o admin bypass).
 */
export async function fetchPedidosWorkflowEstadoIdsParaUsuario(
  session: Exclude<TenantSession, { error: import('next/server').NextResponse }>,
): Promise<{ ok: true; filterIds: string[] | null } | { ok: false; errorMessage: string }> {
  if (session.isSuperAdmin || session.rol === 'admin') {
    logPedidosDiag('bandeja:skip_admin', {
      usuario: shortenId(session.userId),
      rol: session.rol,
    });
    return { ok: true, filterIds: null };
  }

  const { data, error } = await session.supabase
    .from('usuario_pedido_workflow_estado')
    .select('workflow_estado_id')
    .eq('tenant_id', session.tenantId)
    .eq('usuario_id', session.userId);

  if (error) {
    logPedidosDiag('bandeja:query_error', {
      usuario: shortenId(session.userId),
      message: error.message,
      code: error.code,
    });
    return { ok: false, errorMessage: error.message };
  }

  const rows = data ?? [];
  logPedidosDiag('bandeja:query_ok', {
    usuario: shortenId(session.userId),
    tenant: shortenId(session.tenantId),
    filasJunction: rows.length,
  });

  if (rows.length === 0) {
    return { ok: true, filterIds: null };
  }

  const unique = [...new Set(rows.map((r) => r.workflow_estado_id).filter(Boolean))];
  if (unique.length === 0) {
    logPedidosDiag('bandeja:filas_sin_workflow_id', { filasJunction: rows.length });
    return { ok: true, filterIds: null };
  }
  logPedidosDiag('bandeja:filtro_activo', {
    cantidadEstados: unique.length,
    idsPreview: unique.map((id) => shortenId(id)),
  });
  return { ok: true, filterIds: unique };
}

export function pedidoVisibleSegunWorkflow(
  workflowEstadoId: string | null | undefined,
  filterIds: string[] | null,
): boolean {
  if (filterIds === null) return true;
  if (workflowEstadoId == null) return false;
  return filterIds.includes(workflowEstadoId);
}
