import type { SupabaseClient } from '@supabase/supabase-js';

import {
  MOTIVO_ANULACION_MAX_LEN,
  validarMotivoAnulacion,
} from '@/lib/facturacion/anular-comprobante-sin-cae';
import { incrementarSaldoCuentaProveedor } from '@/lib/lector-facturas/cuenta-corriente-helpers';
import {
  hashSnapshot,
  PRECIO_SUCURSAL_SNAPSHOT_SELECT,
  precioSucursalUpdateDesdeSnapshot,
  PRODUCTO_SNAPSHOT_SELECT,
  productoUpdateDesdeSnapshot,
  snapshotCoincide,
  snapshotPreciosSucursal,
  snapshotProductoCatalogo,
  type PrecioSucursalSnapshot,
  type ProductoCatalogoSnapshot,
} from '@/lib/lector-facturas/snapshots-reversion';
import type { Database, Json } from '@/types/database';

type Result =
  | { ok: true; resumen: ReversionFacturaImportadaResumen }
  | { ok: false; status: number; error: string };

export type ReversionFacturaImportadaResumen = {
  stock_movimientos_revertidos: number;
  cuenta_corriente_revertida: number;
  cuenta_corriente_ajuste_neto: number;
  obligaciones_proveedor_anuladas: number;
  pagos_proveedor_compensados: number;
  pagos_proveedor_total_compensado: number;
  productos_restaurados: number;
  productos_desactivados: number;
  productos_omitidos: number;
  precios_sucursal_restaurados: number;
  precios_sucursal_omitidos: number;
  lotes_ajustados: number;
};

type AplicacionFacturaImportada = Database['public']['Tables']['factura_importada_aplicacion']['Row'];
type ProductoSnapshotRow = Pick<
  Database['public']['Tables']['factura_importada_producto_snapshot']['Row'],
  | 'creado_en_confirmacion'
  | 'precio_sucursal_after_hash'
  | 'precio_sucursal_before'
  | 'producto_after_hash'
  | 'producto_before'
  | 'producto_id'
>;

type MovimientoEntrada = Pick<
  Database['public']['Tables']['movimiento']['Row'],
  'cantidad' | 'id' | 'producto_id' | 'producto_variante_id' | 'proveedor_id' | 'sucursal_id'
>;

function n(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function motivoMovimiento(motivo: string, comprobanteId: string): string {
  const maxUserLen = Math.max(0, MOTIVO_ANULACION_MAX_LEN - 100);
  const userText = motivo.length > maxUserLen ? motivo.slice(0, maxUserLen) : motivo;
  return `Reversion factura importada ${comprobanteId.slice(0, 8)} - ${userText}`;
}

function asProductoSnapshot(value: unknown): ProductoCatalogoSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const snapshot = value as Partial<ProductoCatalogoSnapshot>;
  if (
    typeof snapshot.codigo !== 'string' ||
    typeof snapshot.nombre !== 'string' ||
    typeof snapshot.unidad !== 'string' ||
    typeof snapshot.activo !== 'boolean'
  ) {
    return null;
  }
  return snapshot as ProductoCatalogoSnapshot;
}

function asPrecioSnapshots(value: unknown): PrecioSucursalSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is PrecioSucursalSnapshot => {
    if (!row || typeof row !== 'object') return false;
    const r = row as Partial<PrecioSucursalSnapshot>;
    return typeof r.id === 'string' && typeof r.sucursal_id === 'string';
  });
}

async function stockActual(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  mov: MovimientoEntrada,
): Promise<{ ok: true; stock: number } | { ok: false; error: string }> {
  if (mov.producto_variante_id) {
    const { data, error } = await supabase
      .from('producto_variante_stock_sucursal')
      .select('stock_actual')
      .eq('tenant_id', tenantId)
      .eq('producto_id', mov.producto_id)
      .eq('variante_id', mov.producto_variante_id)
      .eq('sucursal_id', mov.sucursal_id)
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    return { ok: true, stock: n(data?.stock_actual) };
  }

  const { data, error } = await supabase
    .from('stock_sucursal')
    .select('stock_actual')
    .eq('tenant_id', tenantId)
    .eq('producto_id', mov.producto_id)
    .eq('sucursal_id', mov.sucursal_id)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, stock: n(data?.stock_actual) };
}

async function productoTieneUsoPosterior(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  productoId: string,
  comprobanteId: string,
): Promise<boolean> {
  const { data: movimientos } = await supabase
    .from('movimiento')
    .select('referencia_id')
    .eq('tenant_id', tenantId)
    .eq('producto_id', productoId)
    .limit(10);
  if ((movimientos ?? []).some((row) => row.referencia_id !== comprobanteId)) {
    return true;
  }

  const { data: items } = await supabase
    .from('comprobante_item')
    .select('comprobante_id')
    .eq('producto_id', productoId)
    .limit(10);
  return (items ?? []).some((row) => row.comprobante_id !== comprobanteId);
}

export async function revertirFacturaImportada(
  supabase: SupabaseClient<Database>,
  ctx: { tenantId: string; userId: string },
  comprobanteId: string,
  motivoReversion: string,
): Promise<Result> {
  const motivoVal = validarMotivoAnulacion(motivoReversion);
  if (!motivoVal.ok) return motivoVal;

  const { data: comp, error: compErr } = await supabase
    .from('comprobante')
    .select(
      'id, tenant_id, sucursal_id, tipo, estado, tipo_operacion, proveedor_id, total, subtotal, iva_monto, percepcion_iibb_monto, percepcion_iva_monto, impuesto_interno_monto',
    )
    .eq('id', comprobanteId)
    .maybeSingle();

  if (compErr || !comp) {
    return { ok: false, status: 500, error: compErr?.message ?? 'Comprobante no encontrado' };
  }
  if (comp.tenant_id !== ctx.tenantId) {
    return { ok: false, status: 404, error: 'Comprobante no encontrado' };
  }
  if (comp.tipo_operacion !== 'compra' || comp.estado !== 'importado') {
    return {
      ok: false,
      status: 400,
      error: 'Solo se pueden revertir compras importadas que aun esten en estado importado.',
    };
  }

  const { data: aplicacionRows, error: appErr } = await supabase
    .from('factura_importada_aplicacion')
    .select('id, afecta_stock, afecta_cuenta_corriente, cuenta_corriente_delta, estado, total')
    .eq('tenant_id', ctx.tenantId)
    .eq('comprobante_id', comprobanteId)
    .limit(1);
  if (appErr) {
    return { ok: false, status: 500, error: appErr.message };
  }
  const aplicacion = (aplicacionRows?.[0] ?? null) as AplicacionFacturaImportada | null;
  if (aplicacion?.estado === 'revertida') {
    return { ok: false, status: 409, error: 'Esta factura importada ya fue revertida.' };
  }

  const { data: pagoProveedor, error: pagoErr } = await supabase
    .from('pago_proveedor_factura')
    .select('id, saldo_pendiente')
    .eq('tenant_id', ctx.tenantId)
    .eq('comprobante_id', comprobanteId)
    .maybeSingle();
  if (pagoErr) {
    return { ok: false, status: 500, error: pagoErr.message };
  }

  const { data: pagosProveedorMovimientos, error: movPagoErr } = pagoProveedor
    ? await supabase
      .from('pago_proveedor_movimiento')
      .select('id, monto, recibo_comprobante_id')
      .eq('tenant_id', ctx.tenantId)
      .eq('pago_proveedor_factura_id', pagoProveedor.id)
    : { data: [], error: null };
  if (movPagoErr) {
    return { ok: false, status: 500, error: movPagoErr.message };
  }

  if ((pagosProveedorMovimientos ?? []).some((mov) => mov.recibo_comprobante_id != null)) {
    return {
      ok: false,
      status: 409,
      error:
        'La obligacion del proveedor tiene pagos con recibo asociado. Anula ese recibo antes de revertir la factura.',
    };
  }
  const totalPagosProveedor = (pagosProveedorMovimientos ?? []).reduce(
    (acc, mov) => acc + n(mov.monto),
    0,
  );

  const { data: movimientos, error: movErr } = await supabase
    .from('movimiento')
    .select('id, producto_id, producto_variante_id, sucursal_id, cantidad, proveedor_id')
    .eq('tenant_id', ctx.tenantId)
    .eq('referencia_id', comprobanteId)
    .eq('tipo', 'entrada')
    .in('referencia_tipo', ['factura_recibida', 'factura_importada']);
  if (movErr) {
    return { ok: false, status: 500, error: movErr.message };
  }

  const debeRevertirStock = aplicacion ? aplicacion.afecta_stock : (movimientos ?? []).length > 0;
  if (debeRevertirStock) {
    for (const mov of movimientos ?? []) {
      const stock = await stockActual(supabase, ctx.tenantId, mov);
      if (!stock.ok) {
        return { ok: false, status: 500, error: `Stock: ${stock.error}` };
      }
      if (stock.stock + 0.000001 < n(mov.cantidad)) {
        return {
          ok: false,
          status: 409,
          error:
            'No hay stock suficiente para revertir la entrada completa. Ajusta el stock o revisa ventas/movimientos posteriores.',
        };
      }
    }
  }

  const resumen: ReversionFacturaImportadaResumen = {
    stock_movimientos_revertidos: 0,
    cuenta_corriente_revertida: 0,
    cuenta_corriente_ajuste_neto: 0,
    obligaciones_proveedor_anuladas: 0,
    pagos_proveedor_compensados: 0,
    pagos_proveedor_total_compensado: 0,
    productos_restaurados: 0,
    productos_desactivados: 0,
    productos_omitidos: 0,
    precios_sucursal_restaurados: 0,
    precios_sucursal_omitidos: 0,
    lotes_ajustados: 0,
  };

  if (debeRevertirStock) {
    for (const mov of movimientos ?? []) {
      const args = {
        p_tenant_id: ctx.tenantId,
        p_producto_id: mov.producto_id,
        p_sucursal_id: mov.sucursal_id,
        p_tipo: 'salida' as const,
        p_cantidad: n(mov.cantidad),
        p_motivo: motivoMovimiento(motivoVal.motivo, comprobanteId),
        p_referencia_tipo: 'factura_recibida' as const,
        p_referencia_id: comprobanteId,
        p_usuario_id: ctx.userId,
        p_proveedor_id: mov.proveedor_id ?? comp.proveedor_id ?? null,
      };
      const { error: rpcErr } = mov.producto_variante_id
        ? await supabase.rpc('registrar_movimiento_variante', {
            ...args,
            p_producto_variante_id: mov.producto_variante_id,
          })
        : await supabase.rpc('registrar_movimiento', args);
      if (rpcErr) {
        return { ok: false, status: 500, error: `Stock: ${rpcErr.message}` };
      }
      resumen.stock_movimientos_revertidos += 1;
    }

    const movimientoIds = (movimientos ?? []).map((mov) => mov.id);
    if (movimientoIds.length > 0) {
      const { error: loteErr } = await supabase
        .from('producto_lote_ingreso')
        .update({ cantidad: 0 })
        .eq('tenant_id', ctx.tenantId)
        .in('movimiento_id', movimientoIds);
      if (loteErr) {
        return { ok: false, status: 500, error: `Lotes: ${loteErr.message}` };
      }
      resumen.lotes_ajustados = movimientoIds.length;
    }
  }

  const debeRevertirCuenta = aplicacion
    ? aplicacion.afecta_cuenta_corriente && n(aplicacion.cuenta_corriente_delta) > 0
    : Boolean(pagoProveedor);
  const totalCuenta = debeRevertirCuenta ? n(comp.total) : 0;
  const ajusteNetoCuenta = debeRevertirCuenta ? totalPagosProveedor - totalCuenta : 0;
  if (debeRevertirCuenta && comp.proveedor_id && Math.abs(ajusteNetoCuenta) > 0.000001) {
    try {
      await incrementarSaldoCuentaProveedor(
        supabase,
        ctx.tenantId,
        comp.proveedor_id,
        ajusteNetoCuenta,
      );
    } catch (e) {
      return { ok: false, status: 500, error: (e as Error).message };
    }
  }
  if (debeRevertirCuenta) {
    resumen.cuenta_corriente_revertida = totalCuenta;
    resumen.cuenta_corriente_ajuste_neto = ajusteNetoCuenta;
    resumen.pagos_proveedor_compensados = pagosProveedorMovimientos?.length ?? 0;
    resumen.pagos_proveedor_total_compensado = totalPagosProveedor;
  }

  if (pagoProveedor) {
    const { error: ppErr } = await supabase
      .from('pago_proveedor_factura')
      .update({ estado: 'anulada', saldo_pendiente: 0 })
      .eq('tenant_id', ctx.tenantId)
      .eq('id', pagoProveedor.id);
    if (ppErr) {
      return { ok: false, status: 500, error: ppErr.message };
    }
    resumen.obligaciones_proveedor_anuladas = 1;
  }

  if (aplicacion) {
    const { data: snapshotRows, error: snapErr } = await supabase
      .from('factura_importada_producto_snapshot')
      .select(
        'producto_id, creado_en_confirmacion, producto_before, producto_after_hash, precio_sucursal_before, precio_sucursal_after_hash',
      )
      .eq('tenant_id', ctx.tenantId)
      .eq('aplicacion_id', aplicacion.id);
    if (snapErr) {
      return { ok: false, status: 500, error: snapErr.message };
    }

    for (const snap of (snapshotRows ?? []) as ProductoSnapshotRow[]) {
      if (snap.creado_en_confirmacion) {
        if (await productoTieneUsoPosterior(supabase, ctx.tenantId, snap.producto_id, comprobanteId)) {
          resumen.productos_omitidos += 1;
          continue;
        }
        const { error: desactivarErr } = await supabase
          .from('producto')
          .update({ activo: false })
          .eq('tenant_id', ctx.tenantId)
          .eq('id', snap.producto_id);
        if (desactivarErr) {
          return { ok: false, status: 500, error: desactivarErr.message };
        }
        resumen.productos_desactivados += 1;
        continue;
      }

      const before = asProductoSnapshot(snap.producto_before);
      if (!before) {
        resumen.productos_omitidos += 1;
        continue;
      }

      const { data: productoActual, error: prodActErr } = await supabase
        .from('producto')
        .select(PRODUCTO_SNAPSHOT_SELECT)
        .eq('tenant_id', ctx.tenantId)
        .eq('id', snap.producto_id)
        .maybeSingle();
      if (prodActErr || !productoActual) {
        return { ok: false, status: 500, error: prodActErr?.message ?? 'Producto no encontrado' };
      }

      if (snapshotCoincide(snapshotProductoCatalogo(productoActual), snap.producto_after_hash)) {
        const { error: prodRestoreErr } = await supabase
          .from('producto')
          .update(productoUpdateDesdeSnapshot(before))
          .eq('tenant_id', ctx.tenantId)
          .eq('id', snap.producto_id);
        if (prodRestoreErr) {
          return { ok: false, status: 500, error: prodRestoreErr.message };
        }
        resumen.productos_restaurados += 1;
      } else {
        resumen.productos_omitidos += 1;
      }

      const precioBefore = asPrecioSnapshots(snap.precio_sucursal_before);
      if (precioBefore.length === 0) continue;
      const { data: preciosActuales, error: precioActErr } = await supabase
        .from('precio_sucursal')
        .select(PRECIO_SUCURSAL_SNAPSHOT_SELECT)
        .eq('tenant_id', ctx.tenantId)
        .eq('producto_id', snap.producto_id);
      if (precioActErr) {
        return { ok: false, status: 500, error: precioActErr.message };
      }

      if (!snapshotCoincide(snapshotPreciosSucursal(preciosActuales ?? []), snap.precio_sucursal_after_hash)) {
        resumen.precios_sucursal_omitidos += precioBefore.length;
        continue;
      }

      for (const precio of precioBefore) {
        const { error: precioRestoreErr } = await supabase
          .from('precio_sucursal')
          .update(precioSucursalUpdateDesdeSnapshot(precio))
          .eq('tenant_id', ctx.tenantId)
          .eq('id', precio.id);
        if (precioRestoreErr) {
          return { ok: false, status: 500, error: precioRestoreErr.message };
        }
        resumen.precios_sucursal_restaurados += 1;
      }
    }
  }

  const resumenConHash = {
    ...resumen,
    hash: hashSnapshot(resumen),
  };
  const anuladoAt = new Date().toISOString();
  const { error: compUpdateErr } = await supabase
    .from('comprobante')
    .update({
      estado: 'anulado' as never,
      pdf_url: null,
      motivo_anulacion: motivoVal.motivo as never,
      anulado_at: anuladoAt as never,
      anulado_por: ctx.userId as never,
    })
    .eq('tenant_id', ctx.tenantId)
    .eq('id', comprobanteId);
  if (compUpdateErr) {
    return { ok: false, status: 500, error: compUpdateErr.message };
  }

  if (aplicacion) {
    const { error: appUpdateErr } = await supabase
      .from('factura_importada_aplicacion')
      .update({
        estado: 'revertida',
        revertida_at: anuladoAt,
        revertida_por: ctx.userId,
        motivo_reversion: motivoVal.motivo,
        resumen_reversion: resumenConHash as unknown as Json,
      })
      .eq('tenant_id', ctx.tenantId)
      .eq('id', aplicacion.id);
    if (appUpdateErr) {
      return { ok: false, status: 500, error: appUpdateErr.message };
    }
  }

  await supabase
    .from('lector_factura_log')
    .update({ estado: 'revertido' as never })
    .eq('tenant_id', ctx.tenantId)
    .eq('comprobante_id', comprobanteId);

  return { ok: true, resumen };
}
