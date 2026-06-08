import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

async function upsertVinculoProductoProveedor(
  supabase: SupabaseClient<Database>,
  params: {
    tenantId: string;
    productoId: string;
    proveedorId: string;
    precioCosto: number;
    /** Solo para la fila del proveedor del archivo: actualiza código; si viene null vacía explícito. */
    codigoProveedorExplicito?: string | null | undefined;
    /** Si true, no se redefine codigo salvo upsert inicial (conserva texto existente en DB). */
    conservarCodigoExistente: boolean;
  },
): Promise<void> {
  let codigoProveedor: string | null;
  if (params.conservarCodigoExistente) {
    const { data: row } = await supabase
      .from('producto_proveedor')
      .select('codigo_proveedor')
      .eq('tenant_id', params.tenantId)
      .eq('producto_id', params.productoId)
      .eq('proveedor_id', params.proveedorId)
      .maybeSingle();
    codigoProveedor = row?.codigo_proveedor ?? null;
  } else if (params.codigoProveedorExplicito !== undefined) {
    codigoProveedor =
      typeof params.codigoProveedorExplicito === 'string' && params.codigoProveedorExplicito.trim()
        ? params.codigoProveedorExplicito.trim()
        : null;
  } else {
    codigoProveedor = null;
  }

  const { error } = await supabase.from('producto_proveedor').upsert(
    {
      tenant_id: params.tenantId,
      producto_id: params.productoId,
      proveedor_id: params.proveedorId,
      precio_costo: params.precioCosto,
      codigo_proveedor: codigoProveedor,
    },
    { onConflict: 'tenant_id,producto_id,proveedor_id' },
  );

  if (error) {
    console.error('[sync-producto-proveedor-import]', error.message);
  }
}

/** Tras alta o actualización por importador: registra vínculos N:N para filtrado y listas de precios. */
export async function sincronizarVinculosProductoProveedorTrasImportacion(
  supabase: SupabaseClient<Database>,
  opts: {
    tenantId: string;
    productoId: string;
    /** Columna producto.proveedor_id ya persistida para esta fila. */
    proveedorIdCatalogo: string | null;
    proveedorIdArchivo: string | null;
    precioCostoCatalogo: number;
    codigoInternoFila: string | null | undefined;
  },
): Promise<void> {
  const { tenantId, productoId, proveedorIdCatalogo, proveedorIdArchivo, precioCostoCatalogo } = opts;

  const unicos = [
    ...new Set(
      [proveedorIdCatalogo, proveedorIdArchivo].filter((id): id is string => typeof id === 'string' && id.trim() !== ''),
    ),
  ];
  if (unicos.length === 0) return;

  const codigo =
    opts.codigoInternoFila && String(opts.codigoInternoFila).trim()
      ? String(opts.codigoInternoFila).trim()
      : null;

  for (const pid of unicos) {
    const esProveedorDelArchivo = proveedorIdArchivo != null && pid === proveedorIdArchivo;
    await upsertVinculoProductoProveedor(supabase, {
      tenantId,
      productoId,
      proveedorId: pid,
      precioCosto: precioCostoCatalogo,
      codigoProveedorExplicito: esProveedorDelArchivo ? codigo : undefined,
      conservarCodigoExistente: !esProveedorDelArchivo,
    });
  }
}
