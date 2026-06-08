import type { SupabaseClient } from '@supabase/supabase-js';

import {
  asPrecioSucursalSnapshots,
  asProductoImportSnapshot,
  productoUpdateDesdeSnapshotImport,
  resumenReversionHash,
  type ProductoImportSnapshot,
} from '@/lib/importar/reversion-productos';
import type { Database, Json } from '@/types/database';

type Result =
  | { ok: true; resumen: ReversionImportacionProductosResumen }
  | { ok: false; status: number; error: string };

export type ReversionImportacionProductosResumen = {
  logs_revertidos: number;
  snapshots_usados: number;
  productos_desactivados: number;
  productos_restaurados: number;
  productos_omitidos: number;
  movimientos_stock_revertidos: number;
  lotes_ajustados: number;
  precios_sucursal_restaurados: number;
  precios_sucursal_eliminados: number;
};

type ImportacionLogReversionRow = Pick<
  Database['public']['Tables']['importacion_log']['Row'],
  'id' | 'carga_id' | 'sucursal_id' | 'productos_creados' | 'productos_actualizados'
> & {
  estado?: 'aplicada' | 'revertida' | string | null;
};

type SnapshotRow = {
  id: string;
  importacion_log_id: string;
  producto_id: string;
  accion: 'created' | 'updated';
  producto_before: unknown;
  producto_after: unknown;
  precio_sucursal_before: unknown;
  movimiento_id: string | null;
  producto_variante_id: string | null;
};

type MovimientoRow = Pick<
  Database['public']['Tables']['movimiento']['Row'],
  | 'id'
  | 'producto_id'
  | 'producto_variante_id'
  | 'proveedor_id'
  | 'sucursal_id'
  | 'stock_anterior'
>;

function n(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function motivoMovimiento(motivo: string, importacionLogId: string): string {
  const text = motivo.trim() || 'Reversion manual de importacion';
  const short = text.length > 120 ? text.slice(0, 120) : text;
  return `Reversion importacion ${importacionLogId.slice(0, 8)} - ${short}`;
}

async function revertirMovimientoStock(
  supabase: SupabaseClient<Database>,
  ctx: { tenantId: string; userId: string },
  mov: MovimientoRow,
  importacionLogId: string,
  motivo: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const baseArgs = {
    p_tenant_id: ctx.tenantId,
    p_producto_id: mov.producto_id,
    p_sucursal_id: mov.sucursal_id,
    p_tipo: 'ajuste' as const,
    p_cantidad: n(mov.stock_anterior),
    p_motivo: motivoMovimiento(motivo, importacionLogId),
    p_referencia_tipo: 'importacion' as const,
    p_referencia_id: importacionLogId,
    p_usuario_id: ctx.userId,
    p_proveedor_id: mov.proveedor_id ?? null,
  };

  const { error } = mov.producto_variante_id
    ? await supabase.rpc('registrar_movimiento_variante', {
        ...baseArgs,
        p_producto_variante_id: mov.producto_variante_id,
      })
    : await supabase.rpc('registrar_movimiento', baseArgs);

  return error ? { ok: false, error: error.message } : { ok: true };
}

async function restaurarPreciosSucursal(
  supabase: SupabaseClient<Database>,
  ctx: { tenantId: string },
  productoId: string,
  beforeRaw: unknown,
): Promise<{ ok: true; restored: number; deleted: number } | { ok: false; error: string }> {
  const before = asPrecioSucursalSnapshots(beforeRaw);
  const { data: actuales, error: actualesErr } = await supabase
    .from('precio_sucursal')
    .select('id')
    .eq('tenant_id', ctx.tenantId)
    .eq('producto_id', productoId);

  if (actualesErr) return { ok: false, error: actualesErr.message };

  const beforeIds = new Set(before.map((row) => row.id));
  const idsAEliminar = (actuales ?? [])
    .map((row) => row.id)
    .filter((id) => !beforeIds.has(id));

  let deleted = 0;
  if (idsAEliminar.length > 0) {
    const { error: delErr, count } = await supabase
      .from('precio_sucursal')
      .delete({ count: 'exact' })
      .eq('tenant_id', ctx.tenantId)
      .eq('producto_id', productoId)
      .in('id', idsAEliminar);
    if (delErr) return { ok: false, error: delErr.message };
    deleted = count ?? idsAEliminar.length;
  }

  let restored = 0;
  for (const precio of before) {
    const { error } = await supabase
      .from('precio_sucursal')
      .upsert(
        {
          id: precio.id,
          tenant_id: ctx.tenantId,
          producto_id: productoId,
          sucursal_id: precio.sucursal_id,
          precio_costo: precio.precio_costo,
          precio_venta: precio.precio_venta,
          porcentaje_ganancia: precio.porcentaje_ganancia,
        },
        { onConflict: 'id' },
      );
    if (error) return { ok: false, error: error.message };
    restored += 1;
  }

  return { ok: true, restored, deleted };
}

async function desactivarProductoCreado(
  supabase: SupabaseClient<Database>,
  ctx: { tenantId: string },
  productoId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error: variantesStockErr } = await supabase
    .from('producto_variante_stock_sucursal')
    .update({ stock_actual: 0 })
    .eq('tenant_id', ctx.tenantId)
    .eq('producto_id', productoId);
  if (variantesStockErr) return { ok: false, error: variantesStockErr.message };

  const { error: variantesErr } = await supabase
    .from('producto_variante')
    .update({ activo: false })
    .eq('tenant_id', ctx.tenantId)
    .eq('producto_id', productoId);
  if (variantesErr) return { ok: false, error: variantesErr.message };

  const { error: productoErr } = await supabase
    .from('producto')
    .update({ activo: false, stock_actual: 0 })
    .eq('tenant_id', ctx.tenantId)
    .eq('id', productoId);
  if (productoErr) return { ok: false, error: productoErr.message };

  return { ok: true };
}

async function restaurarProductoActualizado(
  supabase: SupabaseClient<Database>,
  ctx: { tenantId: string },
  productoId: string,
  before: ProductoImportSnapshot,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase
    .from('producto')
    .update(productoUpdateDesdeSnapshotImport(before))
    .eq('tenant_id', ctx.tenantId)
    .eq('id', productoId);

  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function revertirImportacionProductos(
  supabase: SupabaseClient<Database>,
  ctx: { tenantId: string; userId: string },
  importacionLogId: string,
  opts: { sucursalId: string; motivo?: string },
): Promise<Result> {
  const { data: base, error: baseErr } = await supabase
    .from('importacion_log')
    .select('id, carga_id, sucursal_id, productos_creados, productos_actualizados, estado')
    .eq('tenant_id', ctx.tenantId)
    .eq('id', importacionLogId)
    .or(`sucursal_id.eq.${opts.sucursalId},sucursal_id.is.null`)
    .maybeSingle();

  if (baseErr) return { ok: false, status: 500, error: baseErr.message };
  if (!base) return { ok: false, status: 404, error: 'Importacion no encontrada.' };

  let logsQuery = supabase
    .from('importacion_log')
    .select('id, carga_id, sucursal_id, productos_creados, productos_actualizados, estado')
    .eq('tenant_id', ctx.tenantId)
    .or(`sucursal_id.eq.${opts.sucursalId},sucursal_id.is.null`);

  if (base.carga_id) {
    logsQuery = logsQuery.eq('carga_id', base.carga_id);
  } else {
    logsQuery = logsQuery.eq('id', importacionLogId);
  }

  const { data: logsRaw, error: logsErr } = await logsQuery;
  if (logsErr) return { ok: false, status: 500, error: logsErr.message };

  const logs = (logsRaw ?? []) as ImportacionLogReversionRow[];
  if (logs.length === 0) {
    return { ok: false, status: 404, error: 'Importacion no encontrada.' };
  }
  if (logs.some((log) => log.estado === 'revertida')) {
    return { ok: false, status: 409, error: 'Esta carga ya fue revertida.' };
  }

  const logIds = logs.map((log) => log.id);
  const esperados = logs.reduce(
    (acc, log) => acc + n(log.productos_creados) + n(log.productos_actualizados),
    0,
  );

  const { data: snapshotsRaw, error: snapshotsErr } = await supabase
    .from('importacion_producto_snapshot')
    .select(
      'id, importacion_log_id, producto_id, accion, producto_before, producto_after, precio_sucursal_before, movimiento_id, producto_variante_id',
    )
    .eq('tenant_id', ctx.tenantId)
    .in('importacion_log_id', logIds)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });

  if (snapshotsErr) return { ok: false, status: 500, error: snapshotsErr.message };
  const snapshots = (snapshotsRaw ?? []) as SnapshotRow[];
  if (esperados > 0 && snapshots.length === 0) {
    return {
      ok: false,
      status: 409,
      error:
        'Esta importacion no tiene trazabilidad de reversion. Solo se pueden revertir cargas hechas desde la version nueva.',
    };
  }
  if (snapshots.length < esperados) {
    return {
      ok: false,
      status: 409,
      error:
        'La trazabilidad de esta importacion esta incompleta. No se puede revertir automaticamente sin riesgo.',
    };
  }

  const movimientoIds = [
    ...new Set(snapshots.map((snap) => snap.movimiento_id).filter((id): id is string => Boolean(id))),
  ];
  const movimientos = new Map<string, MovimientoRow>();
  if (movimientoIds.length > 0) {
    const { data: movRows, error: movErr } = await supabase
      .from('movimiento')
      .select('id, producto_id, producto_variante_id, proveedor_id, sucursal_id, stock_anterior')
      .eq('tenant_id', ctx.tenantId)
      .in('id', movimientoIds);
    if (movErr) return { ok: false, status: 500, error: movErr.message };
    for (const mov of movRows ?? []) {
      movimientos.set(mov.id, mov);
    }
  }

  const resumen: ReversionImportacionProductosResumen = {
    logs_revertidos: logs.length,
    snapshots_usados: snapshots.length,
    productos_desactivados: 0,
    productos_restaurados: 0,
    productos_omitidos: 0,
    movimientos_stock_revertidos: 0,
    lotes_ajustados: 0,
    precios_sucursal_restaurados: 0,
    precios_sucursal_eliminados: 0,
  };
  const motivo = opts.motivo?.trim() || 'Reversion manual desde historial de importaciones';

  for (const snap of snapshots) {
    const mov = snap.movimiento_id ? movimientos.get(snap.movimiento_id) : null;
    if (mov) {
      const stock = await revertirMovimientoStock(supabase, ctx, mov, snap.importacion_log_id, motivo);
      if (!stock.ok) return { ok: false, status: 500, error: `Stock: ${stock.error}` };
      resumen.movimientos_stock_revertidos += 1;
    }

    if (snap.accion === 'created') {
      const desactivar = await desactivarProductoCreado(supabase, ctx, snap.producto_id);
      if (!desactivar.ok) return { ok: false, status: 500, error: desactivar.error };
      resumen.productos_desactivados += 1;
      continue;
    }

    const before = asProductoImportSnapshot(snap.producto_before);
    if (!before) {
      resumen.productos_omitidos += 1;
      continue;
    }
    const restore = await restaurarProductoActualizado(supabase, ctx, snap.producto_id, before);
    if (!restore.ok) return { ok: false, status: 500, error: restore.error };
    resumen.productos_restaurados += 1;

    const precios = await restaurarPreciosSucursal(
      supabase,
      ctx,
      snap.producto_id,
      snap.precio_sucursal_before,
    );
    if (!precios.ok) return { ok: false, status: 500, error: `Precios por sucursal: ${precios.error}` };
    resumen.precios_sucursal_restaurados += precios.restored;
    resumen.precios_sucursal_eliminados += precios.deleted;
  }

  const { count: lotesCount, error: lotesErr } = await supabase
    .from('producto_lote_ingreso')
    .update({ cantidad: 0 }, { count: 'exact' })
    .eq('tenant_id', ctx.tenantId)
    .in('importacion_log_id', logIds);
  if (lotesErr) return { ok: false, status: 500, error: `Lotes: ${lotesErr.message}` };
  resumen.lotes_ajustados = lotesCount ?? 0;

  const resumenConHash = {
    ...resumen,
    hash: resumenReversionHash(resumen),
  };
  const revertidaAt = new Date().toISOString();
  const { error: updateErr } = await supabase
    .from('importacion_log')
    .update({
      estado: 'revertida',
      revertida_at: revertidaAt,
      revertida_por: ctx.userId,
      motivo_reversion: motivo,
      resumen_reversion: resumenConHash as unknown as Json,
    })
    .eq('tenant_id', ctx.tenantId)
    .in('id', logIds);

  if (updateErr) return { ok: false, status: 500, error: updateErr.message };

  return { ok: true, resumen };
}
