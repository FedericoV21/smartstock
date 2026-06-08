import type { SupabaseClient } from '@supabase/supabase-js';

import {
  aplicarAjusteGlobalMercaderia,
  aplicarAjusteLineaPrecioUnitario,
  normalizarMontoNoNegativo,
  normalizarPorcentajeManual,
} from '@/lib/facturacion/ajuste-comercial';
import { calcularImportes } from '@/lib/facturacion/calcular-importes';
import { aplicarPromociones } from '@/lib/facturacion/promociones';
import {
  determinarTipoFactura,
  normalizarCondicionIVA,
  type CondicionIVA,
} from '@/lib/facturacion/tipo-comprobante';
import { cargarMapaPromocionesVigentes } from '@/lib/promociones/cargar-mapa';
import { fetchClienteParaUsoEnSucursal } from '@/lib/clientes/cliente-en-sucursal';
import { mergeProductosPrecioDesdeSucursal } from '@/lib/producto/precio-sucursal';
import {
  normalizarRebajaGananciaPct,
  precioUnitarioLineaEmitirConTramos,
} from '@/lib/facturacion/precio-unitario-linea-emitir';
import { mapStockEfectivoEnDeposito } from '@/lib/productos/ids-catalogo-deposito';
import { etiquetaVariante, fetchStockVariantePorIds } from '@/lib/productos/variantes';
import { fetchMapaGananciaTramosPorProductoIds } from '@/lib/productos/fetch-ganancia-tramos-batch';
import { auditLogPosnet } from '@/lib/mp-point/audit-log';
import { hoyEnAR } from '@/lib/utils/formatters';
import type { Database } from '@/types/database';
import { aumentoGananciaHorariaActivo } from '@/lib/business-prefs/ganancia-horaria';
import { effectiveBusinessPrefsFromRows } from '@/lib/business-prefs/prefs';
import { effectivePosPrefsFromRows } from '@/lib/pos/prefs';
import {
  precioUnitarioQueDaSubtotalLinea2Dec,
  subtotalLineaPosConPromoYCentenas,
} from '@/lib/productos/calcular-precio-venta';

import type { EmitirComprobanteBody } from './emitir-comprobante';
import {
  normalizarItemsEmitir,
  type EmitirItemSoloExistente,
} from '@/lib/facturacion/emitir-producto-borrador';

type TipoComprobante = Database['public']['Enums']['tipo_comprobante'];

type Ctx = {
  tenantId: string;
  userId: string;
  sucursalId: string;
  /** Admin / super admin en API: permite borrador con cliente de otra sucursal sin membresía. */
  sinRestriccionClienteTenant?: boolean;
};

export type CrearBorradorTicketBody = Pick<
  EmitirComprobanteBody,
  | 'cliente_id'
  | 'caja_id'
  | 'items'
  | 'stock_bloqueante'
  | 'notas'
  | 'iva_porcentaje'
  | 'descuento_global_pct'
  | 'recargo_global_pct'
  | 'descuento_global_monto'
  | 'recargo_global_monto'
> & {
  /** Alineado con el selector del POS: ticket o factura (A/B/C según IVA). Si no se envía, usa el default del POS (con ARCA suele ser factura). */
  tipo_comprobante_pos?: 'ticket' | 'factura';
};

export type CrearBorradorResult =
  | {
      ok: true;
      comprobante: { id: string; numero: number; numero_orden: number; total: number };
    }
  | { ok: false; status: number; error: string };

/**
 * Crea un comprobante en borrador con ítems (venta POS ticket o factura) para cobrar con Mercado Pago Point.
 */
export async function crearBorradorTicketPos(
  supabase: SupabaseClient<Database>,
  ctx: Ctx,
  body: CrearBorradorTicketBody,
): Promise<CrearBorradorResult> {
  if (!body.items?.length) {
    return { ok: false, status: 400, error: 'La venta no tiene ítems' };
  }

  const { data: tenant } = await supabase
    .from('tenant')
    .select('id, condicion_iva, iva_porcentaje_default, pos_prefs, business_prefs')
    .eq('id', ctx.tenantId)
    .single();

  if (!tenant) {
    return { ok: false, status: 500, error: 'Tenant no encontrado' };
  }

  const { data: sucursalPrefsRow } = await supabase
    .from('sucursal')
    .select('pos_prefs, business_prefs')
    .eq('id', ctx.sucursalId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();

  const posEfectivos = effectivePosPrefsFromRows(
    (tenant as { pos_prefs?: unknown }).pos_prefs,
    sucursalPrefsRow?.pos_prefs ?? null,
  );
  const businessPrefsEfectivos = effectiveBusinessPrefsFromRows(
    (tenant as { business_prefs?: unknown }).business_prefs,
    sucursalPrefsRow?.business_prefs ?? null,
  );
  const redondearPreciosCentenas = posEfectivos.pvpRedondeoCentenasArriba;
  const redondearMenores100ADecenas = posEfectivos.pvpRedondeoMenores100ADecenas;
  const aumentoGananciaHorariaPct = aumentoGananciaHorariaActivo(businessPrefsEfectivos);

  let clienteCondicion: CondicionIVA = 'consumidor_final';
  if (body.cliente_id) {
    const clienteDb = await fetchClienteParaUsoEnSucursal(supabase, {
      tenantId: ctx.tenantId,
      sucursalId: ctx.sucursalId,
      clienteId: body.cliente_id,
      columns: 'condicion_iva',
      sinRestriccionTenant: ctx.sinRestriccionClienteTenant === true,
    });
    if (!clienteDb) {
      return { ok: false, status: 404, error: 'Cliente no encontrado' };
    }
    clienteCondicion = normalizarCondicionIVA(clienteDb.condicion_iva);
  }

  const emisorIva = normalizarCondicionIVA((tenant as { condicion_iva?: string | null }).condicion_iva);
  const quiereFactura = body.tipo_comprobante_pos === 'factura';
  const tipoComprobante = (
    quiereFactura
      ? determinarTipoFactura(emisorIva, clienteCondicion)
      : determinarTipoFactura(emisorIva, clienteCondicion, { quiereTicket: true })
  ) as TipoComprobante;

  const itemsNorm = normalizarItemsEmitir(body.items);
  if (itemsNorm.some((i) => i.tipo === 'borrador')) {
    return {
      ok: false,
      status: 400,
      error:
        'No se puede iniciar el cobro con Mercado Pago mientras haya productos nuevos sin confirmar en el servidor. Cobrá en efectivo o quitá esas líneas.',
    };
  }
  const itemsLinea: EmitirItemSoloExistente[] = itemsNorm as EmitirItemSoloExistente[];

  const productoIds = itemsLinea.map((i) => i.producto_id);
  const productoIdsUnicos = [...new Set(productoIds)];
  const { data: productos, error: productosLookupErr } = await supabase
    .from('producto')
    .select(
      'id, sucursal_id, nombre, stock_actual, precio_costo, precio_venta, porcentaje_ganancia, descuento_costo_pct, iva_porcentaje, es_pesable, es_servicio, usa_variantes',
    )
    .in('id', productoIdsUnicos)
    .eq('tenant_id', ctx.tenantId);

  const filasProducto = productos ?? [];
  const idsEncontrados = new Set(filasProducto.map((p) => p.id));
  const productoIdsFaltantesEnTenant = productoIdsUnicos.filter((id) => !idsEncontrados.has(id));
  if (productosLookupErr || productoIdsFaltantesEnTenant.length > 0) {
    console.warn('[crearBorradorTicketPos] productos no encontrados en tenant', {
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      sucursalId: ctx.sucursalId,
      tipoComprobantePos: body.tipo_comprobante_pos,
      lineas: itemsLinea.length,
      productoIdsEnPedido: productoIdsUnicos,
      filasQuery: filasProducto.length,
      idsFaltantesEnTenant: productoIdsFaltantesEnTenant,
      supabaseError: productosLookupErr?.message ?? null,
    });
    return { ok: false, status: 404, error: 'Algunos productos no fueron encontrados' };
  }

  const stockEfectivoPorProducto = await mapStockEfectivoEnDeposito(
    supabase,
    ctx.tenantId,
    ctx.sucursalId,
    filasProducto.map((p) => ({
      id: p.id,
      sucursal_id: String(p.sucursal_id),
      stock_actual: Number(p.stock_actual),
    })),
  );
  const filasProductoConPrecio = await mergeProductosPrecioDesdeSucursal(
    supabase,
    ctx.tenantId,
    ctx.sucursalId,
    filasProducto,
  );

  const productosMap = new Map(
    filasProductoConPrecio.map((p) => [
      p.id,
      {
        ...p,
        stock_actual: stockEfectivoPorProducto.get(p.id) ?? Number(p.stock_actual),
      },
    ]),
  );
  const varianteIdsUnicos = [
    ...new Set(itemsLinea.map((i) => i.producto_variante_id?.trim() || '').filter(Boolean)),
  ];
  const variantesMap = new Map<string, { producto_id: string; etiqueta: string }>();
  if (varianteIdsUnicos.length > 0) {
    const { data: variantes, error: variantesErr } = await supabase
      .from('producto_variante')
      .select('id, producto_id, atributos, etiqueta')
      .eq('tenant_id', ctx.tenantId)
      .eq('activo', true)
      .in('id', varianteIdsUnicos);
    if (variantesErr) return { ok: false, status: 500, error: variantesErr.message };
    for (const v of variantes ?? []) {
      variantesMap.set(v.id, {
        producto_id: v.producto_id,
        etiqueta: etiquetaVariante(v.atributos, v.etiqueta),
      });
    }
  }
  for (const item of itemsLinea) {
    const prod = productosMap.get(item.producto_id);
    const varianteId = item.producto_variante_id?.trim() || null;
    if ((prod as { usa_variantes?: boolean } | undefined)?.usa_variantes && !varianteId) {
      return {
        ok: false,
        status: 400,
        error: `El producto "${prod?.nombre ?? item.producto_id}" usa variantes. Seleccioná una variante.`,
      };
    }
    if (varianteId) {
      const variante = variantesMap.get(varianteId);
      if (!variante || variante.producto_id !== item.producto_id) {
        return { ok: false, status: 400, error: 'Variante inválida para uno de los productos.' };
      }
    }
  }
  const stockEfectivoPorVariante = await fetchStockVariantePorIds(supabase, {
    tenantId: ctx.tenantId,
    sucursalId: ctx.sucursalId,
    varianteIds: varianteIdsUnicos,
  });
  const exigirStock = body.stock_bloqueante !== false;

  if (exigirStock) {
    const cantidadPorTarget = new Map<string, { producto_id: string; producto_variante_id: string | null; cantidad: number }>();
    for (const item of itemsLinea) {
      if ((productosMap.get(item.producto_id) as { es_servicio?: boolean } | undefined)?.es_servicio === true) continue;
      const varianteId = item.producto_variante_id?.trim() || null;
      const key = varianteId ? `${item.producto_id}:${varianteId}` : item.producto_id;
      const cur = cantidadPorTarget.get(key) ?? {
        producto_id: item.producto_id,
        producto_variante_id: varianteId,
        cantidad: 0,
      };
      cur.cantidad += item.cantidad;
      cantidadPorTarget.set(key, cur);
    }
    for (const target of cantidadPorTarget.values()) {
      const prod = productosMap.get(target.producto_id)!;
      const disponible = target.producto_variante_id
        ? stockEfectivoPorVariante.get(target.producto_variante_id)?.stock_actual ?? 0
        : prod.stock_actual;
      if (disponible < target.cantidad) {
        const nombre = target.producto_variante_id
          ? `${prod.nombre} - ${variantesMap.get(target.producto_variante_id)?.etiqueta ?? 'Variante'}`
          : prod.nombre;
        return {
          ok: false,
          status: 400,
          error: `Stock insuficiente para "${nombre}". Disponible: ${disponible}, solicitado: ${target.cantidad}`,
        };
      }
    }
  }

  const tenantIvaDefault = (tenant as { iva_porcentaje_default?: number | null }).iva_porcentaje_default;
  const ivaFallback = body.iva_porcentaje ?? tenantIvaDefault ?? 21;

  for (const item of itemsLinea) {
    const r = normalizarRebajaGananciaPct(item.rebaja_ganancia_pct);
    if (r <= 0) continue;
    const prod = productosMap.get(item.producto_id);
    const costo = Number(prod?.precio_costo);
    if (!Number.isFinite(costo) || costo <= 0) {
      return {
        ok: false,
        status: 400,
        error: `Rebaja de ganancia no aplicable a «${prod?.nombre ?? item.producto_id}»: el producto necesita costo mayor a cero.`,
      };
    }
  }

  const fechaYmd = hoyEnAR();

  let tramosPorProducto;
  try {
    tramosPorProducto = await fetchMapaGananciaTramosPorProductoIds(
      supabase,
      ctx.tenantId,
      productoIdsUnicos,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 500, error: msg };
  }

  const lineasParaPromos: EmitirItemSoloExistente[] = itemsLinea.map((item) => {
    const prod = productosMap.get(item.producto_id);
    if (!prod) return item;
    const precio_unitario = precioUnitarioLineaEmitirConTramos(
      item,
      prod,
      tramosPorProducto.get(item.producto_id) ?? null,
      ivaFallback,
      redondearPreciosCentenas,
      redondearMenores100ADecenas,
      aumentoGananciaHorariaPct,
    );
    return { ...item, precio_unitario };
  });

  let promosPorProducto;
  try {
    promosPorProducto = await cargarMapaPromocionesVigentes(
      supabase,
      ctx.tenantId,
      productoIds,
      fechaYmd,
      ctx.sucursalId,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 500, error: msg };
  }

  const itemsConPromo = aplicarPromociones(
    lineasParaPromos.map((item) => ({
      producto_id: item.producto_id,
      producto_variante_id: item.producto_variante_id ?? null,
      cantidad: item.cantidad,
      precio_unitario: item.precio_unitario,
      es_pesable: productosMap.get(item.producto_id)?.es_pesable === true,
    })),
    promosPorProducto,
    fechaYmd,
  );

  const itemsConIva = itemsConPromo.map((item, idx) => {
    const prod = productosMap.get(item.producto_id);
    const raw = itemsLinea[idx]!;
    const pu = aplicarAjusteLineaPrecioUnitario(
      item.precio_unitario_efectivo,
      raw.descuento_manual_pct,
      raw.recargo_manual_pct,
    );
    return {
      producto_id: item.producto_id,
      cantidad: item.cantidad,
      precio_unitario: pu,
      iva_porcentaje: prod?.iva_porcentaje ?? ivaFallback,
    };
  });

  const itemsConIvaFinales = redondearPreciosCentenas
    ? itemsConIva.map((row, idx) => {
        const promo = itemsConPromo[idx]!;
        const raw = itemsLinea[idx]!;
        const puLista = aplicarAjusteLineaPrecioUnitario(
          promo.precio_unitario,
          raw.descuento_manual_pct,
          raw.recargo_manual_pct,
        );
        const lineObj = subtotalLineaPosConPromoYCentenas(
          row.cantidad,
          puLista,
          row.precio_unitario,
          promo.descuento_promo_monto,
          {
            redondearCentenas: true,
            redondearMenores100ADecenas,
          },
        );
        if (lineObj <= 0) return row;
        const puOut = precioUnitarioQueDaSubtotalLinea2Dec(row.cantidad, lineObj);
        return { ...row, precio_unitario: puOut };
      })
    : itemsConIva;

  const importesMercaderia = calcularImportes(itemsConIvaFinales, tipoComprobante, ivaFallback);
  const descG = normalizarPorcentajeManual(body.descuento_global_pct);
  const recG = normalizarPorcentajeManual(body.recargo_global_pct);
  const descGm = normalizarMontoNoNegativo(body.descuento_global_monto);
  const recGm = normalizarMontoNoNegativo(body.recargo_global_monto);
  let importes;
  let impTribComercial = 0;
  try {
    const ag = aplicarAjusteGlobalMercaderia(importesMercaderia, tipoComprobante, {
      descPct: descG,
      recPct: recG,
      descMonto: descGm,
      recMonto: recGm,
    });
    importes = ag.importes;
    impTribComercial = ag.impTribComercial;
  } catch {
    return { ok: false, status: 400, error: 'El descuento global supera el total del borrador' };
  }
  const hayAjusteGlobal = descG > 0 || recG > 0 || descGm > 0 || recGm > 0;

  /** Próximo número negativo por tipo: borradores no emitidos (`pendiente_posnet` también ocupa el unique tenant/tipo/numero). */
  const { data: minRow } = await supabase
    .from('comprobante')
    .select('numero')
    .eq('tenant_id', ctx.tenantId)
    .eq('sucursal_id', ctx.sucursalId)
    .eq('tipo', tipoComprobante)
    .lt('numero', 0)
    .order('numero', { ascending: true })
    .limit(1)
    .maybeSingle();

  const siguienteBorradorNum = minRow?.numero != null ? minRow.numero - 1 : -1;

  const { data: ordenRpc, error: ordenErr } = await supabase.rpc('siguiente_numero_orden', {
    p_tenant_id: ctx.tenantId,
  });

  if (ordenErr || ordenRpc == null || typeof ordenRpc !== 'number') {
    return {
      ok: false,
      status: 500,
      error: ordenErr?.message ?? 'No se pudo obtener el número de orden',
    };
  }

  const { data: comp, error: insErr } = await supabase
    .from('comprobante')
    .insert({
      tenant_id: ctx.tenantId,
      sucursal_id: ctx.sucursalId,
      caja_id: body.caja_id?.trim() || null,
      tipo: tipoComprobante,
      numero: siguienteBorradorNum,
      numero_orden: ordenRpc,
      fecha: fechaYmd,
      cliente_id: body.cliente_id || null,
      subtotal: importes.subtotal,
      iva_monto: importes.iva_monto,
      iva_porcentaje: importes.iva_porcentaje,
      total: importes.total,
      estado: 'borrador',
      notas: body.notas?.trim() || null,
      usuario_id: ctx.userId,
      total_mercaderia: hayAjusteGlobal ? importesMercaderia.total : null,
      descuento_global_pct: descG,
      recargo_global_pct: recG,
      descuento_global_monto: descGm,
      recargo_global_monto: recGm,
      imp_trib_comercial: impTribComercial,
    })
    .select('id, numero, numero_orden')
    .single();

  if (insErr || !comp) {
    return { ok: false, status: 500, error: insErr?.message ?? 'Error al crear borrador' };
  }

  const itemsInsert = importes.items.map((item, idx) => {
    const conP = itemsConPromo[idx]!;
    const raw = itemsLinea[idx]!;
    return {
      comprobante_id: comp.id,
      producto_id: item.producto_id,
      producto_variante_id: raw.producto_variante_id ?? null,
      producto_variante_etiqueta: raw.producto_variante_id
        ? variantesMap.get(raw.producto_variante_id)?.etiqueta ?? null
        : null,
      cantidad: item.cantidad,
      precio_unitario: item.precio_unitario,
      subtotal: item.subtotal,
      precio_costo: productosMap.get(item.producto_id)?.precio_costo ?? 0,
      promocion_id: conP.promocion_id,
      promocion_descripcion: conP.promocion_descripcion,
      precio_unitario_original: conP.precio_unitario_original,
      descuento_promo_monto: conP.descuento_promo_monto,
      descuento_manual_pct: normalizarPorcentajeManual(raw.descuento_manual_pct),
      recargo_manual_pct: normalizarPorcentajeManual(raw.recargo_manual_pct),
      rebaja_ganancia_pct: normalizarRebajaGananciaPct(raw.rebaja_ganancia_pct),
    };
  });

  const { error: itemsErr } = await supabase.from('comprobante_item').insert(itemsInsert);

  if (itemsErr) {
    await supabase.from('comprobante').delete().eq('id', comp.id);
    return { ok: false, status: 500, error: `Error al crear ítems: ${itemsErr.message}` };
  }

  const sumaBrutaLineas =
    Math.round(importes.items.reduce((s, it) => s + it.subtotal, 0) * 100) / 100;
  auditLogPosnet('borrador_pos_creado', {
    comprobante_id: comp.id,
    tenant_id: ctx.tenantId,
    sucursal_id: ctx.sucursalId,
    tipo: tipoComprobante,
    numero_orden: ordenRpc,
    total_comprobante: importes.total,
    suma_subtotales_items: sumaBrutaLineas,
    redondeo_centenas: redondearPreciosCentenas,
    redondeo_menores_100_decenas: redondearMenores100ADecenas,
    mercaderia_antes_global: hayAjusteGlobal ? importesMercaderia.total : null,
    descuento_global_pct: descG,
    descuento_global_monto: descGm,
    recargo_global_pct: recG,
    recargo_global_monto: recGm,
    lineas: itemsLinea.length,
  });

  return {
    ok: true,
    comprobante: {
      id: comp.id,
      numero: comp.numero!,
      numero_orden: comp.numero_orden,
      total: importes.total,
    },
  };
}
