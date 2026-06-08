import type { SupabaseClient } from '@supabase/supabase-js';

import {
  aplicarAjusteGlobalMercaderia,
  normalizarMontoNoNegativo,
  normalizarPorcentajeManual,
} from '@/lib/facturacion/ajuste-comercial';
import { calcularImportes } from '@/lib/facturacion/calcular-importes';
import { ESTADOS_COMPROBANTE_MOVIMIENTOS_DIA } from '@/lib/cuenta-corriente/movimientos-dia';
import { hoyEnAR } from '@/lib/utils/formatters';
import type { Database } from '@/types/database';

const TIPOS_LIQUIDABLES = new Set(['ticket', 'factura_b', 'factura_c']);

export type LiquidarItemInput = {
  id: string;
  precio_unitario: number;
};

export type ValidarLiquidacionResult =
  | { ok: true }
  | { ok: false; error: string; status: number };

export function validarComprobanteLiquidable(opts: {
  fechaHoy: string;
  comprobante: {
    fecha: string;
    metodo_pago: string | null;
    estado: string;
    tipo: string;
    cae: string | null;
    sucursal_id: string;
  };
  sucursalId: string;
}): ValidarLiquidacionResult {
  if (opts.comprobante.sucursal_id !== opts.sucursalId) {
    return { ok: false, status: 403, error: 'El comprobante no pertenece a la sucursal indicada.' };
  }
  if (opts.comprobante.fecha !== opts.fechaHoy) {
    return { ok: false, status: 400, error: 'Solo se pueden liquidar comprobantes del día en curso.' };
  }
  if (opts.comprobante.metodo_pago !== 'cuenta_corriente') {
    return { ok: false, status: 400, error: 'Solo aplica a ventas en cuenta corriente.' };
  }
  if (
    !(ESTADOS_COMPROBANTE_MOVIMIENTOS_DIA as readonly string[]).includes(opts.comprobante.estado)
  ) {
    return { ok: false, status: 400, error: 'El comprobante no está en un estado editable.' };
  }
  if (!TIPOS_LIQUIDABLES.has(opts.comprobante.tipo)) {
    return {
      ok: false,
      status: 400,
      error: 'Solo tickets o facturas B/C sin CAE pueden liquidarse desde aquí.',
    };
  }
  if (opts.comprobante.cae?.trim()) {
    return {
      ok: false,
      status: 400,
      error: 'No se pueden modificar importes de un comprobante con CAE emitido.',
    };
  }
  return { ok: true };
}

/** Simplificado: editable si es ticket/factura B/C del día (validación completa en API al guardar). */
export function marcarEditableLiquidacionDia(
  tipo: string,
  cae: string | null | undefined,
): boolean {
  if (cae?.trim()) return false;
  return TIPOS_LIQUIDABLES.has(tipo);
}

type ComprobanteRecalcRow = {
  tipo: string;
  descuento_global_pct: number | null;
  recargo_global_pct: number | null;
  descuento_global_monto: number | null;
  recargo_global_monto: number | null;
  financiacion_monto: number | null;
  imp_trib_comercial: number | null;
  total: number;
};

type ItemRecalcRow = {
  id: string;
  producto_id: string;
  cantidad: number;
  precio_unitario: number;
  descuento_manual_pct: number;
  recargo_manual_pct: number;
  producto: { iva_porcentaje: number | null } | null;
};

export function recalcularImportesComprobanteDesdeItems(
  comprobante: ComprobanteRecalcRow,
  items: ItemRecalcRow[],
  ivaFallback: number,
): { subtotal: number; iva_monto: number; iva_porcentaje: number; total: number; items: { id: string; subtotal: number; precio_unitario: number }[] } {
  const itemsCalc = items.map((it) => ({
    producto_id: it.producto_id,
    cantidad: it.cantidad,
    precio_unitario: Math.max(0, Math.round(it.precio_unitario * 100) / 100),
    iva_porcentaje: it.producto?.iva_porcentaje ?? ivaFallback,
  }));

  const importesMercaderia = calcularImportes(itemsCalc, comprobante.tipo, ivaFallback);

  let importesFinales = importesMercaderia;
  try {
    const ag = aplicarAjusteGlobalMercaderia(importesMercaderia, comprobante.tipo, {
      descPct: normalizarPorcentajeManual(comprobante.descuento_global_pct),
      recPct: normalizarPorcentajeManual(comprobante.recargo_global_pct),
      descMonto: normalizarMontoNoNegativo(comprobante.descuento_global_monto),
      recMonto: normalizarMontoNoNegativo(comprobante.recargo_global_monto),
    });
    importesFinales = ag.importes;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(msg);
  }

  const finMonto = normalizarMontoNoNegativo(comprobante.financiacion_monto);
  const total = Math.round((importesFinales.total + finMonto) * 100) / 100;

  const itemsOut = items.map((it, idx) => {
    const calc = importesFinales.items[idx];
    return {
      id: it.id,
      precio_unitario: calc?.precio_unitario ?? it.precio_unitario,
      subtotal: calc?.subtotal ?? Math.round(it.cantidad * it.precio_unitario * 100) / 100,
    };
  });

  return {
    subtotal: importesFinales.subtotal,
    iva_monto: importesFinales.iva_monto,
    iva_porcentaje: importesFinales.iva_porcentaje,
    total,
    items: itemsOut,
  };
}

export async function liquidarItemsComprobanteCcDia(
  supabase: SupabaseClient<Database>,
  opts: {
    tenantId: string;
    clienteId: string;
    sucursalId: string;
    comprobanteId: string;
    items: LiquidarItemInput[];
    ivaFallback?: number;
  },
): Promise<{ ok: true; total: number; delta: number } | { ok: false; error: string; status: number }> {
  const fechaHoy = hoyEnAR();
  const ivaFallback = opts.ivaFallback ?? 21;

  const { data: comp, error: compErr } = await supabase
    .from('comprobante')
    .select(
      `
      id,
      cliente_id,
      sucursal_id,
      tipo,
      fecha,
      estado,
      metodo_pago,
      cae,
      total,
      subtotal,
      iva_monto,
      iva_porcentaje,
      descuento_global_pct,
      recargo_global_pct,
      descuento_global_monto,
      recargo_global_monto,
      financiacion_monto,
      imp_trib_comercial,
      comprobante_item (
        id,
        producto_id,
        cantidad,
        precio_unitario,
        descuento_manual_pct,
        recargo_manual_pct,
        producto ( iva_porcentaje )
      )
    `,
    )
    .eq('id', opts.comprobanteId)
    .eq('tenant_id', opts.tenantId)
    .maybeSingle();

  if (compErr || !comp) {
    return { ok: false, status: 404, error: 'Comprobante no encontrado.' };
  }

  if (comp.cliente_id !== opts.clienteId) {
    return { ok: false, status: 400, error: 'El comprobante no corresponde a este cliente.' };
  }

  const val = validarComprobanteLiquidable({
    fechaHoy,
    sucursalId: opts.sucursalId,
    comprobante: {
      fecha: comp.fecha,
      metodo_pago: comp.metodo_pago,
      estado: comp.estado,
      tipo: comp.tipo,
      cae: comp.cae,
      sucursal_id: comp.sucursal_id,
    },
  });
  if (!val.ok) return val;

  const dbItems = (comp.comprobante_item ?? []) as ItemRecalcRow[];
  if (dbItems.length === 0) {
    return { ok: false, status: 400, error: 'El comprobante no tiene ítems.' };
  }

  const precioPorId = new Map(
    opts.items.map((i) => [i.id, Math.round(Number(i.precio_unitario) * 100) / 100]),
  );
  for (const row of dbItems) {
    if (!precioPorId.has(row.id)) {
      return { ok: false, status: 400, error: 'Faltan precios para uno o más ítems.' };
    }
    const pu = precioPorId.get(row.id)!;
    if (!Number.isFinite(pu) || pu < 0) {
      return { ok: false, status: 400, error: 'Precio unitario inválido.' };
    }
  }

  const itemsMerged = dbItems.map((row) => ({
    ...row,
    precio_unitario: precioPorId.get(row.id)!,
  }));

  let recalc;
  try {
    recalc = recalcularImportesComprobanteDesdeItems(comp, itemsMerged, ivaFallback);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 400, error: msg };
  }

  const oldTotal = Number(comp.total);
  const delta = Math.round((recalc.total - oldTotal) * 100) / 100;

  const { data: cobranza } = await supabase
    .from('cobranza_factura')
    .select('id, monto_original, saldo_pendiente')
    .eq('comprobante_id', opts.comprobanteId)
    .maybeSingle();

  if (cobranza && Math.abs(delta) >= 0.005) {
    const pagado = Number(cobranza.monto_original) - Number(cobranza.saldo_pendiente);
    const nuevoMonto = Math.round((Number(cobranza.monto_original) + delta) * 100) / 100;
    const nuevoSaldo = Math.round((Number(cobranza.saldo_pendiente) + delta) * 100) / 100;
    if (nuevoMonto < pagado - 0.02) {
      return {
        ok: false,
        status: 400,
        error:
          'El nuevo total no puede ser menor que lo ya cobrado sobre esta factura. Registrá un ajuste manual si corresponde.',
      };
    }
    if (nuevoSaldo < -0.02) {
      return { ok: false, status: 400, error: 'El ajuste dejaría saldo pendiente negativo.' };
    }
  }

  for (const it of recalc.items) {
    const { error: itErr } = await supabase
      .from('comprobante_item')
      .update({
        precio_unitario: precioPorId.get(it.id)!,
        subtotal: it.subtotal,
      })
      .eq('id', it.id)
      .eq('comprobante_id', opts.comprobanteId);
    if (itErr) {
      return { ok: false, status: 500, error: itErr.message };
    }
  }

  const { error: compUpdErr } = await supabase
    .from('comprobante')
    .update({
      subtotal: recalc.subtotal,
      iva_monto: recalc.iva_monto,
      iva_porcentaje: recalc.iva_porcentaje,
      total: recalc.total,
    })
    .eq('id', opts.comprobanteId)
    .eq('tenant_id', opts.tenantId);

  if (compUpdErr) {
    return { ok: false, status: 500, error: compUpdErr.message };
  }

  if (cobranza && Math.abs(delta) >= 0.005) {
    const nuevoMonto = Math.round((Number(cobranza.monto_original) + delta) * 100) / 100;
    const nuevoSaldo = Math.round((Number(cobranza.saldo_pendiente) + delta) * 100) / 100;
    const { error: cobErr } = await supabase
      .from('cobranza_factura')
      .update({
        monto_original: nuevoMonto,
        saldo_pendiente: Math.max(0, nuevoSaldo),
      })
      .eq('id', cobranza.id);
    if (cobErr) {
      return { ok: false, status: 500, error: cobErr.message };
    }
  }

  if (Math.abs(delta) >= 0.005) {
    const { data: cuenta } = await supabase
      .from('cuenta_corriente')
      .select('id, saldo')
      .eq('tenant_id', opts.tenantId)
      .eq('cliente_id', opts.clienteId)
      .maybeSingle();

    if (cuenta) {
      const nuevoSaldoCc = Math.round((Number(cuenta.saldo) + delta) * 100) / 100;
      const { error: ccErr } = await supabase
        .from('cuenta_corriente')
        .update({ saldo: nuevoSaldoCc })
        .eq('id', cuenta.id);
      if (ccErr) {
        return { ok: false, status: 500, error: ccErr.message };
      }
    }
  }

  return { ok: true, total: recalc.total, delta };
}
