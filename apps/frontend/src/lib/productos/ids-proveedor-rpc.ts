import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

export type IdsProveedorRpcArgs = {
  tenantId: string;
  activo: boolean;
  sucursalIds: string[];
  proveedorIds: string[];
  offset: number;
  limit: number;
  ordenPorActualizado: boolean;
  restrVis: string[] | null;
  pCategoriaId: string | null;
  textoBuscableIlike: string | null;
  categoriaIdsPorBusqueda: string[] | null;
};

export type IdsProveedorRpcResult = {
  ids: string[];
  total: number;
  error?: string;
};

function mensajeIndicaRpcFnAusente(msg: string): boolean {
  const t = (msg ?? '').toLowerCase();
  return (
    t.includes('could not find') ||
    t.includes('does not exist') ||
    t.includes('schema cache') ||
    t.includes('not found') ||
    t.includes('unknown function') ||
    (t.includes('function') && t.includes('not exist'))
  );
}

function mensajeIndicaRpcAmbiguous(msg: string): boolean {
  const t = (msg ?? '').toLowerCase();
  return t.includes('could not choose') || t.includes('ambiguous');
}

/** Misma RPC que el listado paginado por proveedor (`GET /api/productos`). */
export async function idsProductosFiltrarProveedoresRpc(
  supabase: SupabaseClient<Database>,
  args: IdsProveedorRpcArgs,
  sinBusquedaNiRubroDropdown: boolean,
): Promise<IdsProveedorRpcResult> {
  const rpcArgsExt: Record<string, unknown> = {
    p_tenant_id: args.tenantId,
    p_activo: args.activo,
    p_sucursal_ids: args.sucursalIds,
    p_proveedor_ids: args.proveedorIds,
    p_offset: args.offset,
    p_limit: args.limit,
    p_orden_por_actualizado: args.ordenPorActualizado,
    p_restringir_a_ids: args.restrVis,
    p_categoria_id: args.pCategoriaId,
    p_texto_buscable_ilike: args.textoBuscableIlike,
    p_categoria_ids_por_busqueda: args.categoriaIdsPorBusqueda,
  };
  const rpcArgs8: Record<string, unknown> = {
    p_tenant_id: args.tenantId,
    p_activo: args.activo,
    p_sucursal_ids: args.sucursalIds,
    p_proveedor_ids: args.proveedorIds,
    p_offset: args.offset,
    p_limit: args.limit,
    p_orden_por_actualizado: args.ordenPorActualizado,
    p_restringir_a_ids: args.restrVis,
  };

  const rpcCliente = supabase as unknown as {
    rpc: (
      fn: string,
      rpcArgs: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  };

  let rpcRows: unknown;
  let rpcErr: { message: string } | null;
  let rpcNombreUsado = 'producto_ids_pagina_filtrar_proveedores_ext';

  const extRes = await rpcCliente.rpc('producto_ids_pagina_filtrar_proveedores_ext', rpcArgsExt);
  rpcRows = extRes.data;
  rpcErr = extRes.error;

  if (
    rpcErr &&
    sinBusquedaNiRubroDropdown &&
    (mensajeIndicaRpcFnAusente(rpcErr.message) || mensajeIndicaRpcAmbiguous(rpcErr.message))
  ) {
    const r8 = await rpcCliente.rpc('producto_ids_pagina_filtrar_proveedores', rpcArgs8);
    rpcRows = r8.data;
    rpcErr = r8.error;
    rpcNombreUsado = 'producto_ids_pagina_filtrar_proveedores';
  }

  if (rpcErr) {
    const ambiguo =
      mensajeIndicaRpcAmbiguous(rpcErr.message) &&
      rpcNombreUsado === 'producto_ids_pagina_filtrar_proveedores';
    const detalle = ambiguo
      ? `${rpcErr.message} Aplicá en Supabase la migración 127 (quita la firma duplicada del RPC de proveedores) o unificá las funciones en la base.`
      : rpcErr.message;
    return { ids: [], total: 0, error: detalle };
  }

  type RpcProvRow = { producto_id: string; full_count: number | string };
  const rr = (Array.isArray(rpcRows) ? rpcRows : []) as RpcProvRow[];
  const total = rr.length > 0 ? Number(rr[0]!.full_count) : 0;
  const ids = rr.map((r) => r.producto_id).filter(Boolean);

  return { ids, total };
}
