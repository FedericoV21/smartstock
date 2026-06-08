import type { SupabaseClient } from '@supabase/supabase-js';

import { loadEffectiveBusinessPrefs } from '@/lib/business-prefs/server';
import {
  CODIGO_BARRAS_PRODUCTO_MAX_LEN,
  esCodigoBarrasAsignable,
} from '@/lib/pos/codigo-barras-producto';
import { calcularPrecioVenta } from '@/lib/productos/calcular-precio-venta';
import { NOMBRE_PRODUCTO_MAX_LEN } from '@/lib/productos/nombre-producto';
import {
  esMatchEstrictoCodigoBarcode,
  registrarLoteIngreso,
} from '@/lib/productos/upsert-con-proveedor';
import type { Database } from '@/types/database';

type UnidadMedida = Database['public']['Enums']['unidad_medida'];

const IVAS_PERMITIDOS = new Set([0, 2.5, 5, 10.5, 21, 27]);

export type ProductoNuevoEmitirBorrador = {
  borrador_id?: string | null;
  codigo_barras: string | null;
  codigo: string;
  nombre: string;
  proveedor_id: string;
  categoria_id: string | null;
  unidad: UnidadMedida;
  precio_costo: number;
  iva_porcentaje: number;
  ganancia_pct: number;
  precio_venta: number;
  stock_inicial: number;
  stock_minimo: number;
  es_pesable: boolean;
  plu: string | null;
  unidad_compra?: UnidadMedida | null;
  contenido_unidad_compra?: number | null;
};

export type EmitirItemBase = {
  cantidad: number;
  precio_unitario: number;
  promocion_id?: string | null;
  promocion_descripcion?: string | null;
  precio_unitario_original?: number | null;
  descuento_promo_monto?: number | null;
  descuento_manual_pct?: number;
  recargo_manual_pct?: number;
  /** Puntos % restados a la ganancia efectiva (POS); opcional. */
  rebaja_ganancia_pct?: number;
  /** Umbral de tramo elegido manualmente en POS para calcular el precio unitario. */
  tramo_ganancia_forzado_cantidad_desde?: number | string | null;
};

export type EmitirItemExistenteInput = EmitirItemBase & {
  tipo?: 'existente';
  producto_id: string;
  producto_variante_id?: string | null;
};

export type EmitirItemBorradorInput = EmitirItemBase & {
  tipo: 'borrador';
  producto_nuevo: ProductoNuevoEmitirBorrador;
};

export type EmitirComprobanteItemInput = EmitirItemExistenteInput | EmitirItemBorradorInput;

export type EmitirItemSoloExistente = EmitirItemExistenteInput & { tipo?: 'existente' };

export function normalizarItemsEmitir(
  items: EmitirComprobanteItemInput[] | undefined | null,
): EmitirComprobanteItemInput[] {
  if (!items?.length) return [];
  return items.map((raw) => {
    if (raw && typeof raw === 'object' && 'tipo' in raw && (raw as { tipo?: string }).tipo === 'borrador') {
      return raw as EmitirItemBorradorInput;
    }
    const r = raw as EmitirItemExistenteInput;
    return { ...r, tipo: 'existente' as const };
  });
}

function esUnidadMedidaValida(u: string): u is UnidadMedida {
  const allowed: UnidadMedida[] = [
    'unidad',
    'kg',
    'gramo',
    'litro',
    'ml',
    'metro',
    'caja',
    'pack',
  ];
  return allowed.includes(u as UnidadMedida);
}

export type ValidarBorradorError =
  | { code: 'PRODUCTO_BORRADOR_INVALIDO'; borrador_id: string | null; errores: Record<string, string> }
  | { code: 'PRODUCTO_BORRADOR_DUPLICADO'; producto_existente_id: string; producto_existente_nombre: string };

export async function validarYInsertarProductoBorrador(
  supabase: SupabaseClient<Database>,
  ctx: { tenantId: string; userId: string },
  sucursalId: string,
  pn: ProductoNuevoEmitirBorrador,
  ivaDefaultTenant: number,
  redondearPreciosCentenas: boolean,
  redondearMenores100ADecenas: boolean = false,
): Promise<
  | { ok: true; producto_id: string; precio_venta: number }
  | { ok: false; status: number; error: string; detalle?: ValidarBorradorError }
> {
  const errores: Record<string, string> = {};
  const borradorId = pn.borrador_id?.trim() || null;

  const codigo = String(pn.codigo ?? '').trim();
  const nombre = String(pn.nombre ?? '').trim();
  if (!codigo || codigo.length > 50) errores.codigo = 'Código inválido (1–50 caracteres)';
  if (!nombre || nombre.length > NOMBRE_PRODUCTO_MAX_LEN) errores.nombre = 'Nombre inválido';

  const proveedorId = String(pn.proveedor_id ?? '').trim();
  if (!proveedorId) errores.proveedor_id = 'Proveedor obligatorio';

  const unidadRaw = String(pn.unidad ?? '').trim();
  if (!esUnidadMedidaValida(unidadRaw)) errores.unidad = 'Unidad inválida';

  const precioCosto = Number(pn.precio_costo);
  if (!Number.isFinite(precioCosto) || precioCosto < 0) errores.precio_costo = 'Costo inválido';

  const ivaPct = Number(pn.iva_porcentaje);
  if (!Number.isFinite(ivaPct) || !IVAS_PERMITIDOS.has(ivaPct)) errores.iva_porcentaje = 'IVA no permitido';

  const gananciaPct = Number(pn.ganancia_pct);
  if (!Number.isFinite(gananciaPct)) errores.ganancia_pct = 'Ganancia inválida';

  const precioVentaCliente = Number(pn.precio_venta);
  if (!Number.isFinite(precioVentaCliente) || precioVentaCliente < 0) errores.precio_venta = 'Precio de venta inválido';

  const stockInicial = Number(pn.stock_inicial);
  const stockMinimo = Number(pn.stock_minimo);
  if (!Number.isFinite(stockInicial) || stockInicial < 0) errores.stock_inicial = 'Stock inicial inválido';
  if (!Number.isFinite(stockMinimo) || stockMinimo < 0) errores.stock_minimo = 'Stock mínimo inválido';

  const esPesable = pn.es_pesable === true;
  const unidad = unidadRaw as UnidadMedida;
  const unidadCompraRaw =
    pn.unidad_compra != null && String(pn.unidad_compra).trim()
      ? String(pn.unidad_compra).trim()
      : null;
  const contenidoUnidadCompraRaw =
    pn.contenido_unidad_compra != null ? Number(pn.contenido_unidad_compra) : null;
  const tienePresentacionCompra = unidadCompraRaw != null || contenidoUnidadCompraRaw != null;
  if (tienePresentacionCompra) {
    if (!unidadCompraRaw || !esUnidadMedidaValida(unidadCompraRaw)) {
      errores.unidad_compra = 'Unidad de compra inválida';
    }
    if (
      !Number.isFinite(contenidoUnidadCompraRaw ?? NaN) ||
      (contenidoUnidadCompraRaw ?? 0) <= 0
    ) {
      errores.contenido_unidad_compra = 'Contenido por caja debe ser mayor a 0';
    }
  }

  if (esPesable && unidad !== 'kg' && unidad !== 'gramo' && unidad !== 'unidad') {
    errores.unidad = 'Producto con PLU: usá unidad, kg o gramo';
  }

  let codigoBarrasRaw: string | null = null;
  if (!esPesable && typeof pn.codigo_barras === 'string' && pn.codigo_barras.trim()) {
    const bar = pn.codigo_barras.trim();
    if (bar.length > CODIGO_BARRAS_PRODUCTO_MAX_LEN) {
      errores.codigo_barras = `Máximo ${CODIGO_BARRAS_PRODUCTO_MAX_LEN} caracteres`;
    } else if (!esCodigoBarrasAsignable(bar)) {
      errores.codigo_barras = 'Código de barras inválido';
    } else {
      codigoBarrasRaw = bar;
    }
  }

  const pluDigits = typeof pn.plu === 'string' ? pn.plu.replace(/\D/g, '').slice(0, 5) : '';
  const plu = esPesable && pluDigits ? pluDigits : null;
  if (esPesable && pn.plu != null && String(pn.plu).trim() && !plu) {
    errores.plu = 'PLU: 1 a 5 dígitos';
  }

  if (proveedorId) {
    const { data: prov, error: pErr } = await supabase
      .from('proveedor')
      .select('id')
      .eq('id', proveedorId)
      .eq('tenant_id', ctx.tenantId)
      .eq('activo', true)
      .maybeSingle();
    if (pErr || !prov) errores.proveedor_id = 'Proveedor no encontrado o inactivo';
  }

  if (pn.categoria_id != null && String(pn.categoria_id).trim()) {
    const cid = String(pn.categoria_id).trim();
    const { data: cat } = await supabase
      .from('categoria')
      .select('id')
      .eq('id', cid)
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle();
    if (!cat) errores.categoria_id = 'Categoría no encontrada';
  }

  const precioTeorico = calcularPrecioVenta(precioCosto, gananciaPct, ivaPct, ivaDefaultTenant, {
    redondearPreciosCentenas,
    redondearMenores100ADecenas,
  });
  if (Math.abs(precioTeorico - precioVentaCliente) > 0.06) {
    errores.precio_venta = 'El precio de venta no coincide con costo, IVA y ganancia';
  }

  if (Object.keys(errores).length) {
    return {
      ok: false,
      status: 400,
      error: 'PRODUCTO_BORRADOR_INVALIDO',
      detalle: { code: 'PRODUCTO_BORRADOR_INVALIDO', borrador_id: borradorId, errores },
    };
  }

  if (codigoBarrasRaw && !proveedorId) {
    const { data: yaExisteBarra } = await supabase
      .from('producto')
      .select('id, nombre')
      .eq('tenant_id', ctx.tenantId)
      .eq('sucursal_id', sucursalId)
      .eq('codigo_barras', codigoBarrasRaw)
      .eq('activo', true)
      .limit(1)
      .maybeSingle();

    if (yaExisteBarra) {
      return {
        ok: false,
        status: 409,
        error: 'PRODUCTO_BORRADOR_DUPLICADO',
        detalle: {
          code: 'PRODUCTO_BORRADOR_DUPLICADO',
          producto_existente_id: yaExisteBarra.id,
          producto_existente_nombre: yaExisteBarra.nombre ?? '',
        },
      };
    }
  }

  if (codigoBarrasRaw && proveedorId) {
    const { data: dup } = await supabase
      .from('producto')
      .select('id, nombre')
      .eq('tenant_id', ctx.tenantId)
      .eq('sucursal_id', sucursalId)
      .eq('codigo_barras', codigoBarrasRaw)
      .eq('proveedor_id', proveedorId)
      .eq('activo', true)
      .limit(1)
      .maybeSingle();
    if (dup) {
      return {
        ok: false,
        status: 409,
        error: 'PRODUCTO_BORRADOR_DUPLICADO',
        detalle: {
          code: 'PRODUCTO_BORRADOR_DUPLICADO',
          producto_existente_id: dup.id,
          producto_existente_nombre: dup.nombre ?? '',
        },
      };
    }
  }

  // Pref unificación entre proveedores: si está activa, un alta-al-vuelo cuyo `código + código_barras`
  // coincide con un producto existente (cualquier proveedor) se trata como duplicado y devuelve la fila
  // existente. El POS puede ofrecer reusarla en vez de crear un nuevo SKU.
  const businessPrefsPos = await loadEffectiveBusinessPrefs(supabase, ctx.tenantId, sucursalId);
  if (businessPrefsPos.unificarProductosEntreProveedores && codigoBarrasRaw && codigo) {
    const { data: candidatos } = await supabase
      .from('producto')
      .select('id, nombre, codigo, codigo_barras, proveedor_id')
      .eq('tenant_id', ctx.tenantId)
      .eq('codigo', codigo)
      .eq('activo', true);
    const cross = (candidatos ?? []).filter(
      (p) =>
        esMatchEstrictoCodigoBarcode(
          { codigo, codigo_barras: codigoBarrasRaw },
          { codigo: p.codigo, codigo_barras: p.codigo_barras },
        ) && p.proveedor_id !== proveedorId,
    );
    if (cross.length > 0) {
      const existente = cross[0]!;
      return {
        ok: false,
        status: 409,
        error: 'PRODUCTO_BORRADOR_DUPLICADO',
        detalle: {
          code: 'PRODUCTO_BORRADOR_DUPLICADO',
          producto_existente_id: existente.id,
          producto_existente_nombre: existente.nombre ?? '',
        },
      };
    }
  }

  if (plu) {
    const { data: dupPlu } = await supabase
      .from('producto')
      .select('id')
      .eq('tenant_id', ctx.tenantId)
      .eq('plu', plu)
      .eq('activo', true)
      .limit(1)
      .maybeSingle();
    if (dupPlu) {
      return {
        ok: false,
        status: 409,
        error: 'Ya existe un producto activo con ese PLU',
      };
    }
  }

  const categoriaId =
    pn.categoria_id != null && String(pn.categoria_id).trim() ? String(pn.categoria_id).trim() : null;

  const precioVentaGuardado = precioTeorico;

  const { data: producto, error } = await supabase
    .from('producto')
    .insert({
      tenant_id: ctx.tenantId,
      sucursal_id: sucursalId,
      codigo,
      nombre,
      descripcion: null,
      categoria_id: categoriaId,
      proveedor_id: proveedorId,
      unidad,
      precio_costo: precioCosto,
      precio_venta: precioVentaGuardado,
      stock_actual: 0,
      stock_minimo: stockMinimo,
      fecha_vencimiento: null,
      rubro: null,
      subrubro: null,
      iva_porcentaje: ivaPct,
      porcentaje_ganancia: gananciaPct,
      ubicacion: null,
      moneda: '$',
      codigo_barras: codigoBarrasRaw,
      es_pesable: esPesable,
      plu,
      unidad_compra: unidadCompraRaw as UnidadMedida | null,
      contenido_unidad_compra: contenidoUnidadCompraRaw,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      const msg =
        error.message.includes('idx_producto_barcode') || error.message.includes('codigo_barras')
          ? 'PRODUCTO_BORRADOR_DUPLICADO'
          : error.message.includes('plu')
            ? 'Ya existe un producto activo con ese PLU'
            : `Ya existe un producto con el código '${codigo}'`;
      if (msg === 'PRODUCTO_BORRADOR_DUPLICADO') {
        return { ok: false, status: 409, error: msg };
      }
      return { ok: false, status: 409, error: msg };
    }
    return { ok: false, status: 400, error: error.message };
  }

  if (!producto?.id) {
    return { ok: false, status: 500, error: 'No se pudo crear el producto' };
  }

  const pid = producto.id;

  let movimientoInicialPosId: string | null = null;
  if (stockInicial > 0) {
    const { data: movRow, error: movError } = await supabase.rpc('registrar_movimiento', {
      p_tenant_id: ctx.tenantId,
      p_producto_id: pid,
      p_sucursal_id: sucursalId,
      p_tipo: 'entrada',
      p_cantidad: stockInicial,
      p_motivo: 'Stock inicial — alta desde POS',
      p_referencia_tipo: 'manual',
      p_referencia_id: null,
      p_usuario_id: ctx.userId,
      p_proveedor_id: proveedorId || null,
    });
    if (movError) {
      await supabase.from('producto').delete().eq('id', pid).eq('tenant_id', ctx.tenantId);
      return {
        ok: false,
        status: 500,
        error: `Falló el stock inicial del producto nuevo: ${movError.message}`,
      };
    }
    movimientoInicialPosId = (movRow as { id: string } | null)?.id ?? null;
  }

  if (businessPrefsPos.registrarLotesPorIngreso && stockInicial > 0) {
    const { error: loteErr } = await registrarLoteIngreso(supabase, {
      tenantId: ctx.tenantId,
      productoId: pid,
      sucursalId,
      proveedorId: proveedorId || null,
      cantidad: stockInicial,
      fechaVencimiento: null,
      precioCosto: precioCosto || null,
      origen: 'pos',
      movimientoId: movimientoInicialPosId,
      creadoPor: ctx.userId,
    });
    if (loteErr) {
      console.error('[validarYInsertarProductoBorrador] producto_lote_ingreso:', loteErr);
    }
  }

  return { ok: true, producto_id: pid, precio_venta: precioVentaGuardado };
}

export async function resolverItemsProductosBorrador(
  supabase: SupabaseClient<Database>,
  ctx: { tenantId: string; userId: string },
  sucursalId: string,
  items: EmitirComprobanteItemInput[],
  ivaDefaultTenant: number,
  redondearPreciosCentenas: boolean,
  redondearMenores100ADecenas: boolean = false,
): Promise<
  | {
      ok: true;
      items: EmitirItemSoloExistente[];
      productos_creados: { borrador_id: string | null; producto_id: string }[];
    }
  | { ok: false; status: number; error: string; detalle?: ValidarBorradorError }
> {
  const productos_creados: { borrador_id: string | null; producto_id: string }[] = [];
  const salida: EmitirItemSoloExistente[] = [];
  const idsInsertadosEnEstaPasada: string[] = [];

  for (const it of items) {
    if (it.tipo === 'borrador') {
      if (it.promocion_id != null || (it.descuento_promo_monto ?? 0) > 0) {
        if (idsInsertadosEnEstaPasada.length) {
          await supabase
            .from('producto')
            .delete()
            .in('id', idsInsertadosEnEstaPasada)
            .eq('tenant_id', ctx.tenantId);
        }
        return {
          ok: false,
          status: 400,
          error: 'No se permiten promociones en ítems de producto nuevo desde POS',
        };
      }
      const r = await validarYInsertarProductoBorrador(
        supabase,
        ctx,
        sucursalId,
        it.producto_nuevo,
        ivaDefaultTenant,
        redondearPreciosCentenas,
        redondearMenores100ADecenas,
      );
      if (!r.ok) {
        if (idsInsertadosEnEstaPasada.length) {
          await supabase
            .from('producto')
            .delete()
            .in('id', idsInsertadosEnEstaPasada)
            .eq('tenant_id', ctx.tenantId);
        }
        return { ok: false, status: r.status, error: r.error, detalle: r.detalle };
      }
      idsInsertadosEnEstaPasada.push(r.producto_id);
      productos_creados.push({
        borrador_id: it.producto_nuevo.borrador_id?.trim() || null,
        producto_id: r.producto_id,
      });
      salida.push({
        tipo: 'existente',
        producto_id: r.producto_id,
        cantidad: it.cantidad,
        precio_unitario: r.precio_venta,
        promocion_id: null,
        promocion_descripcion: null,
        precio_unitario_original: null,
        descuento_promo_monto: null,
        descuento_manual_pct: it.descuento_manual_pct,
        recargo_manual_pct: it.recargo_manual_pct,
      });
    } else {
      salida.push({
        tipo: 'existente',
        producto_id: it.producto_id,
        cantidad: it.cantidad,
        precio_unitario: it.precio_unitario,
        promocion_id: it.promocion_id,
        promocion_descripcion: it.promocion_descripcion,
        precio_unitario_original: it.precio_unitario_original,
        descuento_promo_monto: it.descuento_promo_monto,
        descuento_manual_pct: it.descuento_manual_pct,
        recargo_manual_pct: it.recargo_manual_pct,
      });
    }
  }

  return { ok: true, items: salida, productos_creados };
}
