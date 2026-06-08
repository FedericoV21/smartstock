import type { SupabaseClient } from '@supabase/supabase-js';

import {
  calcularVencimientoDia,
  proveedorTieneCondicionPagoCargada,
  vencimientoDefaultPersonalizado,
  vencimientoTimestamptzDesdeDia,
  type CondicionPagoProveedorDb,
  type PagoProveedorInput,
  type ProveedorCondicionPago,
} from '@/lib/cuenta-corriente/pago-proveedor-vencimiento';
import { calcularSaldoPendienteNuevoCargo } from '@/lib/cuenta-corriente/saldo';
import { effectiveBusinessPrefsFromRows } from '@/lib/business-prefs/prefs';
import {
  calcularImportes,
  importesPreferiendoTotalInformado,
  type Importes,
} from '@/lib/facturacion/calcular-importes';
import { incrementarSaldoCuentaCliente, incrementarSaldoCuentaProveedor } from '@/lib/lector-facturas/cuenta-corriente-helpers';
import {
  findProveedorPorCuitNorm,
  findProveedorPorNombreSimilar,
  normCuit,
} from '@/lib/lector-facturas/direccion';
import {
  mapUnidadFacturaTexto,
  normalizarLineaLectorFactura,
} from '@/lib/lector-facturas/normalizar-linea-lector-factura';
import { numeroComprobanteImportado } from '@/lib/lector-facturas/numero-importado';
import {
  hashSnapshot,
  PRECIO_SUCURSAL_SNAPSHOT_SELECT,
  PRODUCTO_SNAPSHOT_SELECT,
  snapshotPreciosSucursal,
  snapshotProductoCatalogo,
  type PrecioSucursalSnapshot,
  type ProductoCatalogoSnapshot,
} from '@/lib/lector-facturas/snapshots-reversion';
import { effectivePosPrefsFromRows } from '@/lib/pos/prefs';
import { recalcularPreciosSucursalConGanancia } from '@/lib/producto/precio-sucursal';
import { calcularPrecioVenta } from '@/lib/productos/calcular-precio-venta';
import {
  buscarProductoIdPorCodigoInternoTenant,
  esCodigoAutoGeneradoDesdeFactura,
} from '@/lib/productos/buscar-por-codigo-interno';
import { decidirNuevoCosto, registrarLoteIngreso } from '@/lib/productos/upsert-con-proveedor';
import type { Database, Json } from '@/types/database';

type TipoComprobante = Database['public']['Enums']['tipo_comprobante'];

export const TIPOS_PERMITIDOS_CONFIRMAR_IMPORTADO = new Set<string>([
  'factura_a',
  'factura_b',
  'factura_c',
  'nota_credito_a',
  'nota_credito_b',
  'nota_credito_c',
  'remito',
  'ticket',
]);

/** Tipos de comprobante que representan una nota de crédito (cualquier letra). */
export function esTipoNotaCredito(tipo: string): boolean {
  return tipo.startsWith('nota_credito');
}

export function comprobanteActualizaIvaProducto(tipo: string): boolean {
  return tipo !== 'remito';
}

export function preciosItemsConIvaIncluidoAplican(tipo: string, solicitado: boolean): boolean {
  return solicitado && comprobanteActualizaIvaProducto(tipo);
}

const ESTADOS_PAGO_PROVEEDOR = new Set<string>([
  'ya_pagada',
  'pendiente_condicion',
  'pendiente_fecha_custom',
]);

const TIPOS_PAGO = new Set<string>(['efectivo', 'transferencia', 'cheque', 'tarjeta', 'otro']);

/**
 * Valida y parsea el bloque de pago a proveedores. `null` = usar defaults en el servidor.
 */
export function parsePagoProveedorField(raw: unknown): PagoProveedorInput | null {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  const estado = p.estado;
  if (typeof estado !== 'string' || !ESTADOS_PAGO_PROVEEDOR.has(estado)) return null;
  if (estado === 'ya_pagada') {
    const fp = typeof p.fecha_pago === 'string' ? p.fecha_pago.slice(0, 10) : null;
    const tp = typeof p.tipo_pago === 'string' ? p.tipo_pago : null;
    if (!fp || !/^\d{4}-\d{2}-\d{2}$/.test(fp) || !tp || !TIPOS_PAGO.has(tp)) {
      return null;
    }
    return { estado, fecha_pago: fp, tipo_pago: tp as PagoProveedorInput['tipo_pago'] };
  }
  if (estado === 'pendiente_fecha_custom') {
    const v = typeof p.vencimiento_at === 'string' ? p.vencimiento_at.slice(0, 10) : null;
    if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    return { estado, vencimiento_at: v };
  }
  if (estado === 'pendiente_condicion') {
    return { estado };
  }
  return null;
}

function proveedorRowACond(p: { condicion_pago_default: string; plazo_pago_dias: number | null } | null) {
  if (!p) return null;
  const c: ProveedorCondicionPago = {
    condicion_pago_default: p.condicion_pago_default === 'dias' ? 'dias' : 'contado',
    plazo_pago_dias: p.plazo_pago_dias,
  };
  return c;
}

/**
 * Criterio de negocio: si el cliente no envió `pago`, elegimos “condición del proveedor”
 * o “fecha personalizada” según tenga o no plazo/condición cargada.
 */
export function resuelvePagoProveedorEfectivo(
  body: ConfirmarImportadoBody,
  prov: { condicion_pago_default: string; plazo_pago_dias: number | null } | null,
): PagoProveedorInput {
  if (body.pago) {
    return body.pago;
  }
  const fechaF = body.fecha.slice(0, 10);
  const c = proveedorRowACond(prov);
  if (proveedorTieneCondicionPagoCargada(c)) {
    return { estado: 'pendiente_condicion' };
  }
  return {
    estado: 'pendiente_fecha_custom',
    vencimiento_at: vencimientoDefaultPersonalizado(fechaF, body.fecha_vencimiento_sugerida),
  };
}

export type ItemConfirmarImportadoIn = {
  producto_id: string | null;
  crear_desde_factura: { nombre: string; codigo: string | null } | null;
  cantidad: number;
  precio_unitario: number;
  precio_costo: number;
  iva_porcentaje: number | null;
  /** Glosa de unidad leída en la línea (IA); sirve para inferir pack junto al nombre. */
  unidad_factura: string | null;
  /** Texto descriptivo de la línea en la factura (lector); opcional en compra manual. */
  descripcion_factura: string | null;
  /** Código interno leído en la factura (para sincronizar catálogo si hay match). */
  codigo_factura: string | null;
  /** Como interpretar cantidad/precio si el producto tiene presentacion de compra configurada. */
  presentacion_modo?: 'auto' | 'unidad_base' | 'presentacion_compra';
  /** Contenido por unidad de compra informado en UI (ej. 1 caja = 6 unidades). */
  contenido_presentacion_compra?: number | null;
};

export type ConfirmarImportadoBody = {
  log_id: string | null;
  direccion: 'recibida' | 'emitida' | 'desconocida';
  proveedor_id: string | null;
  cliente_id: string | null;
  crear_proveedor: { razon_social: string; cuit: string } | null;
  crear_cliente: { razon_social: string; cuit_dni: string } | null;
  tipo_comprobante: string;
  tipo_operacion: 'venta' | 'compra';
  fecha: string;
  punto_venta: number | null;
  numero_documento: number | null;
  cae: string | null;
  cae_vencimiento: string | null;
  items: ItemConfirmarImportadoIn[];
  subtotal: number;
  iva_monto: number;
  percepcion_iibb_monto: number;
  percepcion_iva_monto: number;
  impuesto_interno_monto: number;
  total: number;
  actualizar_costos: boolean;
  afecta_stock: boolean;
  afecta_cuenta_corriente: boolean;
  /** Texto libre (p. ej. compra manual). */
  observaciones: string | null;
  /** Fecha vencimiento en factura (lector / IA o manual). */
  fecha_vencimiento_sugerida: string | null;
  /** Cuenta por pagar: solo compra + recibida + CC. */
  pago: PagoProveedorInput | null;
  /** Inferir caja/pack desde nombre/descripción (mismo criterio que import Excel). Solo lector. */
  inferir_presentacion_compra_desde_nombre?: boolean;
  /** Precio unitario de línea viene con IVA incluido; el costo guardado es neto (sin IVA). */
  precios_items_con_iva_incluido?: boolean;
  /** Compra manual: respetar subtotal, IVA y total cargados en cabecera. */
  importes_manuales?: boolean;
};

type ItemResuelto = {
  producto_id: string;
  cantidad: number;
  precio_unitario: number;
  precio_costo: number;
  aplico_inferencia_pack?: boolean;
};

export type ActualizacionCostoProducto = {
  producto_id: string;
  codigo: string | null;
  nombre: string;
  precio_costo_anterior: number | null;
  precio_costo_nuevo: number;
  precio_venta_anterior: number | null;
  precio_venta_nuevo: number | null;
  variacion_pct: number | null;
};

const TOLERANCIA_CAMBIO_COSTO = 0.005;
const UMBRAL_BONIFICACION_O_REPOSICION = 0.000001;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function totalPercepcionesFactura(
  body: Pick<
    ConfirmarImportadoBody,
    'percepcion_iibb_monto' | 'percepcion_iva_monto' | 'impuesto_interno_monto'
  >,
): number {
  return round2(
    Math.max(0, body.percepcion_iibb_monto) +
      Math.max(0, body.percepcion_iva_monto) +
      Math.max(0, body.impuesto_interno_monto),
  );
}

function costoPrevioValido(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const n = Number(value);
  return n > UMBRAL_BONIFICACION_O_REPOSICION ? n : null;
}

function claveProductoFactura(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return key.length > 0 ? key : null;
}

/**
 * Línea bonificada/reposición: entra stock, pero no debe recalcular costo/venta.
 */
export function esLineaBonificacionOReposicion(
  item: Pick<ItemResuelto, 'precio_unitario'> & Partial<Pick<ItemResuelto, 'precio_costo'>>,
): boolean {
  return Number(item.precio_unitario) <= UMBRAL_BONIFICACION_O_REPOSICION;
}

export function importesDesdeCabeceraManual(
  body: Pick<
    ConfirmarImportadoBody,
    | 'subtotal'
    | 'iva_monto'
    | 'percepcion_iibb_monto'
    | 'percepcion_iva_monto'
    | 'impuesto_interno_monto'
    | 'total'
  >,
  base: Importes,
): Importes {
  const subtotal = round2(Math.max(0, body.subtotal));
  const iva_monto = round2(Math.max(0, body.iva_monto));
  const total = round2(Math.max(0, body.total));
  const iva_porcentaje =
    subtotal > 0 && iva_monto > 0 ? round2((iva_monto * 100) / subtotal) : base.iva_porcentaje;

  return {
    ...base,
    subtotal,
    iva_monto,
    iva_porcentaje,
    total,
    items: base.items.map((i) => ({ ...i })),
  };
}

export function importesConPercepciones(importes: Importes, percepciones: number): Importes {
  const monto = round2(Math.max(0, percepciones));
  if (monto <= 0) return { ...importes, items: importes.items.map((i) => ({ ...i })) };
  return {
    ...importes,
    total: round2(importes.total + monto),
    items: importes.items.map((i) => ({ ...i })),
  };
}

export function construirActualizacionCostoProducto(args: {
  producto_id: string;
  codigo: string | null;
  nombre: string | null;
  precio_costo_anterior: number | null;
  precio_costo_nuevo: number;
  precio_venta_anterior: number | null;
  precio_venta_nuevo?: number | null;
}): ActualizacionCostoProducto | null {
  const anterior = costoPrevioValido(args.precio_costo_anterior);
  const nuevo = Number(args.precio_costo_nuevo);
  if (!Number.isFinite(nuevo)) return null;
  if (anterior != null && Math.abs(anterior - nuevo) <= TOLERANCIA_CAMBIO_COSTO) return null;

  const variacionPct =
    anterior != null && anterior > 0 ? round2(((nuevo - anterior) / anterior) * 100) : null;

  return {
    producto_id: args.producto_id,
    codigo: args.codigo,
    nombre: args.nombre?.trim() || 'Producto sin nombre',
    precio_costo_anterior: anterior,
    precio_costo_nuevo: nuevo,
    precio_venta_anterior: args.precio_venta_anterior,
    precio_venta_nuevo: args.precio_venta_nuevo ?? args.precio_venta_anterior,
    variacion_pct: variacionPct,
  };
}

function unidadCatalogoDesdeLineaFactura(
  unidad_factura: string | null,
  aplico_inferencia_pack: boolean | undefined,
): Database['public']['Enums']['unidad_medida'] {
  const u = mapUnidadFacturaTexto(unidad_factura);
  if (
    aplico_inferencia_pack &&
    (u === 'caja' || u === 'pack')
  ) {
    return 'unidad';
  }
  return u;
}

function parseOptionalNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.trim().replace(',', '.'));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function parseItemsRaw(itemsRaw: unknown): ItemConfirmarImportadoIn[] {
  if (!Array.isArray(itemsRaw)) return [];
  const items: ItemConfirmarImportadoIn[] = [];
  for (const row of itemsRaw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const producto_id =
      typeof r.producto_id === 'string' && r.producto_id.length > 0 ? r.producto_id : null;

    let crear_desde_factura: { nombre: string; codigo: string | null } | null = null;
    if (r.crear_desde_factura && typeof r.crear_desde_factura === 'object') {
      const c = r.crear_desde_factura as Record<string, unknown>;
      const nombre = typeof c.nombre === 'string' ? c.nombre.trim() : '';
      if (nombre) {
        const codigo = typeof c.codigo === 'string' ? c.codigo.trim() : '';
        crear_desde_factura = { nombre, codigo: codigo || null };
      }
    }

    if (producto_id && crear_desde_factura) continue;
    if (!producto_id && !crear_desde_factura) continue;

    const cantidad = Number(r.cantidad);
    const precio_unitario = Number(r.precio_unitario);
    const precio_costo = Number(r.precio_costo);
    if (Number.isNaN(cantidad) || cantidad <= 0) continue;
    if (Number.isNaN(precio_unitario) || precio_unitario < 0) continue;

    const ivaRaw = r.iva_porcentaje;
    const iva_porcentaje =
      typeof ivaRaw === 'number' && Number.isFinite(ivaRaw) ? ivaRaw : null;
    const unidad_factura =
      typeof r.unidad_factura === 'string' && r.unidad_factura.trim().length > 0
        ? r.unidad_factura.trim()
        : null;

    const descRaw = r.descripcion_factura;
    const descripcion_factura =
      typeof descRaw === 'string' && descRaw.trim().length > 0 ? descRaw.trim() : null;

    const codFacRaw = r.codigo_factura;
    const codigo_factura =
      typeof codFacRaw === 'string' && codFacRaw.trim().length > 0 ? codFacRaw.trim() : null;
    const pmRaw = r.presentacion_modo;
    const presentacion_modo =
      pmRaw === 'unidad_base' || pmRaw === 'presentacion_compra' || pmRaw === 'auto'
        ? pmRaw
        : 'auto';
    const cpcRaw = r.contenido_presentacion_compra;
    const contenido_presentacion_compra =
      typeof cpcRaw === 'number' && Number.isFinite(cpcRaw) && cpcRaw > 0 ? cpcRaw : null;

    items.push({
      producto_id,
      crear_desde_factura: producto_id ? null : crear_desde_factura,
      cantidad,
      precio_unitario,
      precio_costo: Number.isNaN(precio_costo) ? precio_unitario : precio_costo,
      iva_porcentaje,
      unidad_factura,
      descripcion_factura,
      codigo_factura,
      presentacion_modo,
      contenido_presentacion_compra,
    });
  }
  return items;
}

/**
 * Parsea el body del lector (requiere log_id y tipo_operacion).
 */
export function parseConfirmarImportadoLectorJson(raw: unknown): ConfirmarImportadoBody | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const b = raw as Record<string, unknown>;

  const log_id = typeof b.log_id === 'string' ? b.log_id : '';
  const direccion =
    b.direccion === 'recibida' || b.direccion === 'emitida' || b.direccion === 'desconocida'
      ? b.direccion
      : null;
  const tipo_operacion =
    b.tipo_operacion === 'compra' || b.tipo_operacion === 'venta' ? b.tipo_operacion : null;
  const tipo_comprobante = typeof b.tipo_comprobante === 'string' ? b.tipo_comprobante : '';
  const fecha = typeof b.fecha === 'string' ? b.fecha : '';

  if (!log_id || !direccion || !tipo_operacion || !tipo_comprobante || !fecha) return null;

  const items = parseItemsRaw(b.items);
  const subtotal = Number(b.subtotal);
  const iva_monto = Number(b.iva_monto);
  const percepcion_iibb_monto = Number(b.percepcion_iibb_monto ?? 0);
  const percepcion_iva_monto = Number(b.percepcion_iva_monto ?? 0);
  const impuesto_interno_monto = Number(b.impuesto_interno_monto ?? 0);
  const total = Number(b.total);
  if (
    Number.isNaN(subtotal) ||
    Number.isNaN(iva_monto) ||
    Number.isNaN(percepcion_iibb_monto) ||
    Number.isNaN(percepcion_iva_monto) ||
    Number.isNaN(impuesto_interno_monto) ||
    Number.isNaN(total)
  ) return null;
  if (
    subtotal < 0 ||
    iva_monto < 0 ||
    percepcion_iibb_monto < 0 ||
    percepcion_iva_monto < 0 ||
    impuesto_interno_monto < 0 ||
    total < 0
  ) return null;

  let crear_proveedor: { razon_social: string; cuit: string } | null = null;
  if (b.crear_proveedor && typeof b.crear_proveedor === 'object') {
    const c = b.crear_proveedor as Record<string, unknown>;
    const rs = typeof c.razon_social === 'string' ? c.razon_social.trim() : '';
    const cuit = typeof c.cuit === 'string' ? c.cuit.replace(/\D/g, '') : '';
    if (rs && cuit.length === 11) crear_proveedor = { razon_social: rs, cuit };
  }

  let crear_cliente: { razon_social: string; cuit_dni: string } | null = null;
  if (b.crear_cliente && typeof b.crear_cliente === 'object') {
    const c = b.crear_cliente as Record<string, unknown>;
    const rs = typeof c.razon_social === 'string' ? c.razon_social.trim() : '';
    const cuit_dni = typeof c.cuit_dni === 'string' ? c.cuit_dni.replace(/\D/g, '') : '';
    if (rs && cuit_dni.length === 11) crear_cliente = { razon_social: rs, cuit_dni };
  }

  const obs = typeof b.observaciones === 'string' ? b.observaciones.trim() : '';
  const pv = parseOptionalNumber(b.punto_venta);
  const nd = parseOptionalNumber(b.numero_documento);
  const fvSug = typeof b.fecha_vencimiento_sugerida === 'string' ? b.fecha_vencimiento_sugerida : null;

  const provP = parsePagoProveedorField(b.pago);
  if (b.pago != null && provP == null) return null;

  return {
    log_id,
    direccion,
    proveedor_id: typeof b.proveedor_id === 'string' ? b.proveedor_id : null,
    cliente_id: typeof b.cliente_id === 'string' ? b.cliente_id : null,
    crear_proveedor,
    crear_cliente,
    tipo_comprobante,
    tipo_operacion,
    fecha,
    punto_venta: pv,
    numero_documento: nd,
    cae: typeof b.cae === 'string' ? b.cae : null,
    cae_vencimiento: typeof b.cae_vencimiento === 'string' ? b.cae_vencimiento : null,
    items,
    subtotal,
    iva_monto,
    percepcion_iibb_monto,
    percepcion_iva_monto,
    impuesto_interno_monto,
    total,
    actualizar_costos: b.actualizar_costos === true,
    afecta_stock: b.afecta_stock !== false,
    afecta_cuenta_corriente: b.afecta_cuenta_corriente !== false,
    observaciones: obs || null,
    fecha_vencimiento_sugerida: fvSug,
    pago: provP,
    inferir_presentacion_compra_desde_nombre: b.inferir_presentacion_compra_desde_nombre === true,
    precios_items_con_iva_incluido: b.precios_items_con_iva_incluido === true,
    importes_manuales: b.importes_manuales === true,
  };
}

/**
 * Compra recibida cargada a mano (sin extracción IA).
 */
export function parseCompraProveedorManualJson(raw: unknown): ConfirmarImportadoBody | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const b = raw as Record<string, unknown>;

  const tipo_comprobante = typeof b.tipo_comprobante === 'string' ? b.tipo_comprobante : '';
  const fecha = typeof b.fecha === 'string' ? b.fecha : '';
  if (!tipo_comprobante || !fecha) return null;

  const items = parseItemsRaw(b.items);
  const subtotal = Number(b.subtotal);
  const iva_monto = Number(b.iva_monto);
  const percepcion_iibb_monto = Number(b.percepcion_iibb_monto ?? 0);
  const percepcion_iva_monto = Number(b.percepcion_iva_monto ?? 0);
  const impuesto_interno_monto = Number(b.impuesto_interno_monto ?? 0);
  const total = Number(b.total);
  if (
    Number.isNaN(subtotal) ||
    Number.isNaN(iva_monto) ||
    Number.isNaN(percepcion_iibb_monto) ||
    Number.isNaN(percepcion_iva_monto) ||
    Number.isNaN(impuesto_interno_monto) ||
    Number.isNaN(total)
  ) return null;
  if (
    subtotal < 0 ||
    iva_monto < 0 ||
    percepcion_iibb_monto < 0 ||
    percepcion_iva_monto < 0 ||
    impuesto_interno_monto < 0 ||
    total < 0
  ) return null;

  let crear_proveedor: { razon_social: string; cuit: string } | null = null;
  if (b.crear_proveedor && typeof b.crear_proveedor === 'object') {
    const c = b.crear_proveedor as Record<string, unknown>;
    const rs = typeof c.razon_social === 'string' ? c.razon_social.trim() : '';
    const cuit = typeof c.cuit === 'string' ? c.cuit.replace(/\D/g, '') : '';
    if (rs && cuit.length === 11) crear_proveedor = { razon_social: rs, cuit };
  }

  const obs = typeof b.observaciones === 'string' ? b.observaciones.trim() : '';
  const pv = parseOptionalNumber(b.punto_venta);
  const nd = parseOptionalNumber(b.numero_documento);
  const fvSug = typeof b.fecha_vencimiento_sugerida === 'string' ? b.fecha_vencimiento_sugerida : null;

  const provP2 = parsePagoProveedorField(b.pago);
  if (b.pago != null && provP2 == null) return null;

  return {
    log_id: null,
    direccion: 'recibida',
    proveedor_id: typeof b.proveedor_id === 'string' ? b.proveedor_id : null,
    cliente_id: null,
    crear_proveedor,
    crear_cliente: null,
    tipo_comprobante,
    tipo_operacion: 'compra',
    fecha,
    punto_venta: pv,
    numero_documento: nd,
    cae: typeof b.cae === 'string' ? b.cae : null,
    cae_vencimiento: typeof b.cae_vencimiento === 'string' ? b.cae_vencimiento : null,
    items,
    subtotal,
    iva_monto,
    percepcion_iibb_monto,
    percepcion_iva_monto,
    impuesto_interno_monto,
    total,
    actualizar_costos: b.actualizar_costos === true,
    afecta_stock: b.afecta_stock !== false,
    afecta_cuenta_corriente: b.afecta_cuenta_corriente !== false,
    observaciones: obs || null,
    fecha_vencimiento_sugerida: fvSug,
    pago: provP2,
    importes_manuales: b.importes_manuales === true,
  };
}

export function validarItemsConfirmarImportado(body: ConfirmarImportadoBody): string | null {
  if (body.items.length === 0) return 'Debe haber al menos un ítem';
  if (body.tipo_operacion === 'venta') {
    for (const it of body.items) {
      if (!it.producto_id) return 'En ventas, todos los ítems deben tener un producto del catálogo.';
    }
  } else {
    for (const it of body.items) {
      if (!it.producto_id && !it.crear_desde_factura) {
        return 'En compras, cada ítem sin producto debe incluir datos para dar de alta el producto.';
      }
    }
  }
  return null;
}

export type EjecutarConfirmacionImportadoResult =
  | { ok: true; comprobante_id: string; actualizaciones_costos: ActualizacionCostoProducto[] }
  | { ok: false; status: number; error: string; detalle?: unknown };

export async function ejecutarConfirmacionImportado(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  sucursalId: string,
  userId: string,
  body: ConfirmarImportadoBody,
  origen: 'lector' | 'manual',
): Promise<EjecutarConfirmacionImportadoResult> {
  if (body.log_id) {
    const { data: logRow, error: logErr } = await supabase
      .from('lector_factura_log')
      .select('id, estado, tenant_id')
      .eq('id', body.log_id)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (logErr || !logRow) {
      return { ok: false, status: 404, error: 'Extracción no encontrada' };
    }
    if (logRow.estado !== 'extraido') {
      return {
        ok: false,
        status: 409,
        error: 'Esta extracción ya fue confirmada o no está disponible',
      };
    }
  }

  let proveedorId = body.proveedor_id;
  let clienteId = body.cliente_id;

  if (body.crear_proveedor) {
    const { data: proveedoresExistentes } = await supabase
      .from('proveedor')
      .select('id, cuit, nombre')
      .eq('tenant_id', tenantId);
    const provRows = proveedoresExistentes ?? [];
    const provExistente =
      findProveedorPorCuitNorm(provRows, normCuit(body.crear_proveedor.cuit)) ??
      findProveedorPorNombreSimilar(provRows, body.crear_proveedor.razon_social);

    if (provExistente) {
      proveedorId = provExistente.id;
    } else {
      const { data: nuevo, error: pe } = await supabase
        .from('proveedor')
        .insert({
          tenant_id: tenantId,
          sucursal_id: sucursalId,
          nombre: body.crear_proveedor.razon_social,
          cuit: body.crear_proveedor.cuit,
        })
        .select('id')
        .single();
      if (pe || !nuevo) {
        return {
          ok: false,
          status: 400,
          error: pe?.message ?? 'No se pudo crear el proveedor',
        };
      }
      proveedorId = nuevo.id;
    }
  }

  if (body.crear_cliente) {
    const { data: nuevo, error: ce } = await supabase
      .from('cliente')
      .insert({
        tenant_id: tenantId,
        sucursal_id: sucursalId,
        nombre: body.crear_cliente.razon_social,
        razon_social: body.crear_cliente.razon_social,
        cuit_dni: body.crear_cliente.cuit_dni,
      })
      .select('id')
      .single();
    if (ce || !nuevo) {
      return {
        ok: false,
        status: 400,
        error: ce?.message ?? 'No se pudo crear el cliente',
      };
    }
    clienteId = nuevo.id;
  }

  if (body.tipo_operacion === 'compra' && !proveedorId) {
    return {
      ok: false,
      status: 400,
      error: 'Factura de compra: indicá o creá un proveedor',
    };
  }
  if (body.tipo_operacion === 'venta' && !clienteId) {
    return {
      ok: false,
      status: 400,
      error: 'Factura de venta: indicá o creá un cliente',
    };
  }

  const { data: tenant } = await supabase
    .from('tenant')
    .select('iva_porcentaje_default, pos_prefs, business_prefs')
    .eq('id', tenantId)
    .maybeSingle();

  const ivaDefault = tenant?.iva_porcentaje_default ?? 21;
  const posPrefsLector = effectivePosPrefsFromRows(tenant?.pos_prefs, null);
  const redondearPreciosCentenas = posPrefsLector.pvpRedondeoCentenasArriba;
  const redondearMenores100ADecenas = posPrefsLector.pvpRedondeoMenores100ADecenas;

  const { data: sucursalPrefsRow } = await supabase
    .from('sucursal')
    .select('business_prefs')
    .eq('id', sucursalId)
    .maybeSingle();
  const businessPrefs = effectiveBusinessPrefsFromRows(
    tenant?.business_prefs,
    sucursalPrefsRow?.business_prefs ?? null,
  );
  const precioCostoSoloSubeLF = businessPrefs.precioCostoSoloSube === true;
  const registrarLotesLF = businessPrefs.registrarLotesPorIngreso === true;

  const inferirPack =
    origen === 'lector' && body.inferir_presentacion_compra_desde_nombre === true;
  const preciosIvaIncl =
    origen === 'lector' &&
    preciosItemsConIvaIncluidoAplican(
      body.tipo_comprobante,
      body.precios_items_con_iva_incluido === true,
    );
  const sincronizaIvaProducto = comprobanteActualizaIvaProducto(body.tipo_comprobante);

  type ProdMini = {
    nombre: string;
    unidad: Database['public']['Enums']['unidad_medida'];
    unidad_compra: Database['public']['Enums']['unidad_medida'] | null;
    contenido_unidad_compra: number | null;
  };
  const prodMiniCache = new Map<string, ProdMini>();
  const idsPref = [...new Set(body.items.map((x) => x.producto_id).filter(Boolean))] as string[];
  if (idsPref.length > 0) {
    const { data: prefRows } = await supabase
      .from('producto')
      .select('id, nombre, unidad, unidad_compra, contenido_unidad_compra')
      .eq('tenant_id', tenantId)
      .in('id', idsPref);
    for (const row of prefRows ?? []) {
      prodMiniCache.set(row.id, {
        nombre: row.nombre,
        unidad: row.unidad,
        unidad_compra: row.unidad_compra ?? null,
        contenido_unidad_compra: row.contenido_unidad_compra ?? null,
      });
    }
  }

  async function ensureProdMini(pid: string): Promise<ProdMini | null> {
    const hit = prodMiniCache.get(pid);
    if (hit) return hit;
    const { data } = await supabase
      .from('producto')
      .select('nombre, unidad, unidad_compra, contenido_unidad_compra')
      .eq('id', pid)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (!data) return null;
    const m = {
      nombre: data.nombre,
      unidad: data.unidad,
      unidad_compra: data.unidad_compra ?? null,
      contenido_unidad_compra: data.contenido_unidad_compra ?? null,
    };
    prodMiniCache.set(pid, m);
    return m;
  }

  let autoCodigoSeq = 0;
  const resolvedItems: ItemResuelto[] = [];
  const idsProductoAltaEnEstaConfirmacion = new Set<string>();
  const prefijoCodigoAuto = origen === 'manual' ? 'CMP' : 'LFA';
  const productoPorCodigoFactura = new Map<string, string>();
  const productoPorDescripcionFactura = new Map<string, string>();

  for (const itemBody of body.items) {
    if (!itemBody.producto_id) continue;
    const codigoKey = itemBody.codigo_factura?.trim().toLowerCase() ?? '';
    if (codigoKey) {
      productoPorCodigoFactura.set(codigoKey, itemBody.producto_id);
    }
    const descKey = claveProductoFactura(itemBody.descripcion_factura);
    if (descKey) {
      productoPorDescripcionFactura.set(descKey, itemBody.producto_id);
    }
  }

  for (const it of body.items) {
    if (it.producto_id) {
      const mini =
        prodMiniCache.get(it.producto_id) ?? (await ensureProdMini(it.producto_id));
      const unidadStock = mini?.unidad ?? mapUnidadFacturaTexto(it.unidad_factura);
      const nombreCatalogo = mini?.nombre ?? null;
      const norm = normalizarLineaLectorFactura({
        descripcion_factura:
          it.descripcion_factura ?? '',
        nombre_producto_catalogo: nombreCatalogo,
        unidad_factura: it.unidad_factura,
        unidad_stock_producto: unidadStock,
        cantidad: it.cantidad,
        precio_unitario: it.precio_unitario,
        precio_costo_input: it.precio_costo,
        inferir_pack: inferirPack,
        presentacion_modo: it.presentacion_modo ?? 'auto',
        contenido_presentacion_compra:
          it.contenido_presentacion_compra ?? mini?.contenido_unidad_compra ?? null,
        precios_con_iva_incluido: preciosIvaIncl,
        iva_porcentaje: it.iva_porcentaje,
        iva_default: ivaDefault,
      });
      resolvedItems.push({
        producto_id: it.producto_id,
        cantidad: norm.cantidad,
        precio_unitario: norm.precio_unitario,
        precio_costo: norm.precio_costo,
        aplico_inferencia_pack: norm.aplico_inferencia_pack,
      });
      const codigoKey = it.codigo_factura?.trim().toLowerCase() ?? '';
      if (codigoKey) {
        productoPorCodigoFactura.set(codigoKey, it.producto_id);
      }
      const descKey = claveProductoFactura(it.descripcion_factura);
      if (descKey) {
        productoPorDescripcionFactura.set(descKey, it.producto_id);
      }
      continue;
    }

    if (body.tipo_operacion !== 'compra' || !it.crear_desde_factura) {
      return { ok: false, status: 400, error: 'Ítem inválido' };
    }

    const codigoDesdeFactura = it.crear_desde_factura.codigo?.trim() ?? '';
    // Lector: enlazar con el catálogo sólo por código interno (cualquier proveedor / hogar de sucursal).
    if (
      origen === 'lector' &&
      codigoDesdeFactura &&
      !esCodigoAutoGeneradoDesdeFactura(codigoDesdeFactura)
    ) {
      const existenteId = await buscarProductoIdPorCodigoInternoTenant(
        supabase,
        tenantId,
        codigoDesdeFactura,
      );
      if (existenteId) {
        const mini =
          prodMiniCache.get(existenteId) ?? (await ensureProdMini(existenteId));
        const unidadStock = mini?.unidad ?? mapUnidadFacturaTexto(it.unidad_factura);
        const nombreCatalogo = mini?.nombre ?? null;
        const norm = normalizarLineaLectorFactura({
          descripcion_factura:
            it.descripcion_factura ?? it.crear_desde_factura.nombre,
          nombre_producto_catalogo: nombreCatalogo,
          unidad_factura: it.unidad_factura,
          unidad_stock_producto: unidadStock,
          cantidad: it.cantidad,
          precio_unitario: it.precio_unitario,
          precio_costo_input: it.precio_costo,
          inferir_pack: inferirPack,
          presentacion_modo: it.presentacion_modo ?? 'auto',
          contenido_presentacion_compra:
            it.contenido_presentacion_compra ?? mini?.contenido_unidad_compra ?? null,
          precios_con_iva_incluido: preciosIvaIncl,
          iva_porcentaje: it.iva_porcentaje,
          iva_default: ivaDefault,
        });
        resolvedItems.push({
          producto_id: existenteId,
          cantidad: norm.cantidad,
          precio_unitario: norm.precio_unitario,
          precio_costo: norm.precio_costo,
          aplico_inferencia_pack: norm.aplico_inferencia_pack,
        });
        productoPorCodigoFactura.set(codigoDesdeFactura.toLowerCase(), existenteId);
        const descKey = claveProductoFactura(it.descripcion_factura ?? it.crear_desde_factura.nombre);
        if (descKey) {
          productoPorDescripcionFactura.set(descKey, existenteId);
        }
        continue;
      }
    }

    if (origen === 'lector') {
      const codigoKey = codigoDesdeFactura.toLowerCase();
      const descKey = claveProductoFactura(it.descripcion_factura ?? it.crear_desde_factura.nombre);
      const productoReutilizable =
        (codigoKey ? productoPorCodigoFactura.get(codigoKey) : null) ??
        (descKey ? productoPorDescripcionFactura.get(descKey) : null) ??
        null;
      if (productoReutilizable) {
        const mini =
          prodMiniCache.get(productoReutilizable) ?? (await ensureProdMini(productoReutilizable));
        const unidadStock = mini?.unidad ?? mapUnidadFacturaTexto(it.unidad_factura);
        const nombreCatalogo = mini?.nombre ?? null;
        const norm = normalizarLineaLectorFactura({
          descripcion_factura:
            it.descripcion_factura ?? it.crear_desde_factura.nombre,
          nombre_producto_catalogo: nombreCatalogo,
          unidad_factura: it.unidad_factura,
          unidad_stock_producto: unidadStock,
          cantidad: it.cantidad,
          precio_unitario: it.precio_unitario,
          precio_costo_input: it.precio_costo,
          inferir_pack: inferirPack,
          presentacion_modo: it.presentacion_modo ?? 'auto',
          contenido_presentacion_compra:
            it.contenido_presentacion_compra ?? mini?.contenido_unidad_compra ?? null,
          precios_con_iva_incluido: preciosIvaIncl,
          iva_porcentaje: it.iva_porcentaje,
          iva_default: ivaDefault,
        });
        resolvedItems.push({
          producto_id: productoReutilizable,
          cantidad: norm.cantidad,
          precio_unitario: norm.precio_unitario,
          precio_costo: norm.precio_costo,
          aplico_inferencia_pack: norm.aplico_inferencia_pack,
        });
        if (codigoKey) {
          productoPorCodigoFactura.set(codigoKey, productoReutilizable);
        }
        if (descKey) {
          productoPorDescripcionFactura.set(descKey, productoReutilizable);
        }
        continue;
      }
    }

    let codigo = codigoDesdeFactura;
    if (!codigo) {
      codigo = `${prefijoCodigoAuto}-${Date.now()}-${autoCodigoSeq++}`;
    }
    for (let attempt = 0; attempt < 8; attempt++) {
      const { data: dupRows } = await supabase
        .from('producto')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('sucursal_id', sucursalId)
        .eq('codigo', codigo)
        .eq('activo', true)
        .limit(1);
      if (!dupRows?.length) break;
      codigo = `${prefijoCodigoAuto}-${Date.now()}-${autoCodigoSeq++}-${attempt}`;
    }

    const unidadStockGlosa = mapUnidadFacturaTexto(it.unidad_factura);
    const norm = normalizarLineaLectorFactura({
      descripcion_factura:
        it.descripcion_factura ?? it.crear_desde_factura.nombre,
      nombre_producto_catalogo: null,
      unidad_factura: it.unidad_factura,
      unidad_stock_producto: unidadStockGlosa,
      cantidad: it.cantidad,
      precio_unitario: it.precio_unitario,
      precio_costo_input: it.precio_costo,
      inferir_pack: inferirPack,
      presentacion_modo: it.presentacion_modo ?? 'auto',
      contenido_presentacion_compra: it.contenido_presentacion_compra ?? null,
      precios_con_iva_incluido: preciosIvaIncl,
      iva_porcentaje: it.iva_porcentaje,
      iva_default: ivaDefault,
    });

    const ivaP = it.iva_porcentaje ?? ivaDefault;
    const ivaProductoNuevo = sincronizaIvaProducto ? ivaP : null;
    const costo = norm.precio_costo;
    const precioVenta = calcularPrecioVenta(costo, 0, ivaProductoNuevo, ivaDefault, {
      redondearPreciosCentenas,
      redondearMenores100ADecenas,
    });

    let unidadProd = mapUnidadFacturaTexto(it.unidad_factura);
    if (
      norm.aplico_inferencia_pack &&
      (unidadProd === 'caja' || unidadProd === 'pack')
    ) {
      unidadProd = 'unidad';
    }

    const { data: nuevo, error: insErr } = await supabase
      .from('producto')
      .insert({
        tenant_id: tenantId,
        sucursal_id: sucursalId,
        codigo,
        nombre: it.crear_desde_factura.nombre.slice(0, 500),
        proveedor_id: proveedorId,
        unidad: unidadProd,
        precio_costo: costo,
        precio_venta: precioVenta,
        stock_actual: 0,
        stock_minimo: 0,
        iva_porcentaje: ivaProductoNuevo,
        moneda: '$',
      })
      .select('id')
      .single();

    if (insErr || !nuevo) {
      return {
        ok: false,
        status: 400,
        error: insErr?.message ?? 'No se pudo crear el producto desde la factura',
      };
    }

    idsProductoAltaEnEstaConfirmacion.add(nuevo.id);

    resolvedItems.push({
      producto_id: nuevo.id,
      cantidad: norm.cantidad,
      precio_unitario: norm.precio_unitario,
      precio_costo: norm.precio_costo,
      aplico_inferencia_pack: norm.aplico_inferencia_pack,
    });
    const codigoKey = codigo.trim().toLowerCase();
    if (codigoKey) {
      productoPorCodigoFactura.set(codigoKey, nuevo.id);
    }
    const descKey = claveProductoFactura(it.descripcion_factura ?? it.crear_desde_factura.nombre);
    if (descKey) {
      productoPorDescripcionFactura.set(descKey, nuevo.id);
    }
  }

  /** Snapshot de catálogo antes de aplicar cambios de factura/costos. */
  const productoIds = [...new Set(resolvedItems.map((i) => i.producto_id))];
  const productoBeforeSnapshotById = new Map<string, ProductoCatalogoSnapshot | null>();
  const precioSucursalBeforeSnapshotById = new Map<string, PrecioSucursalSnapshot[]>();

  if (body.tipo_operacion === 'compra' && productoIds.length > 0) {
    const { data: productoRowsBefore, error: productoBeforeErr } = await supabase
      .from('producto')
      .select(PRODUCTO_SNAPSHOT_SELECT)
      .eq('tenant_id', tenantId)
      .in('id', productoIds);

    if (productoBeforeErr) {
      console.error('[confirmacion-importado] snapshot producto before:', productoBeforeErr.message);
    } else {
      for (const row of productoRowsBefore ?? []) {
        productoBeforeSnapshotById.set(
          row.id,
          idsProductoAltaEnEstaConfirmacion.has(row.id) ? null : snapshotProductoCatalogo(row),
        );
      }
    }

    const { data: precioRowsBefore, error: precioBeforeErr } = await supabase
      .from('precio_sucursal')
      .select(PRECIO_SUCURSAL_SNAPSHOT_SELECT)
      .eq('tenant_id', tenantId)
      .in('producto_id', productoIds);

    if (precioBeforeErr) {
      console.error('[confirmacion-importado] snapshot precio_sucursal before:', precioBeforeErr.message);
    } else {
      for (const productId of productoIds) {
        precioSucursalBeforeSnapshotById.set(
          productId,
          snapshotPreciosSucursal((precioRowsBefore ?? []).filter((row) => row.producto_id === productId)),
        );
      }
    }
  }

  /** Catálogo: alinear datos del producto con la factura (sin tocar precio_costo aquí). */
  if (
    origen === 'lector' &&
    body.tipo_operacion === 'compra' &&
    proveedorId &&
    body.items.length === resolvedItems.length
  ) {
    for (let idx = 0; idx < body.items.length; idx++) {
      const it = body.items[idx]!;
      const res = resolvedItems[idx]!;
      if (idsProductoAltaEnEstaConfirmacion.has(res.producto_id)) continue;

      const nombreFuente =
        (it.descripcion_factura ?? '').trim() ||
        (it.crear_desde_factura?.nombre ?? '').trim();

      const updates: Database['public']['Tables']['producto']['Update'] = {};

      if (nombreFuente.length > 0) {
        updates.nombre = nombreFuente.slice(0, 500);
      }

      const codFuente = it.codigo_factura?.trim();
      if (
        codFuente &&
        codFuente.length > 0 &&
        !esCodigoAutoGeneradoDesdeFactura(codFuente)
      ) {
        updates.codigo = codFuente.slice(0, 255);
      }

      updates.unidad = unidadCatalogoDesdeLineaFactura(
        it.unidad_factura,
        res.aplico_inferencia_pack,
      );
      updates.proveedor_id = proveedorId;
      if (sincronizaIvaProducto) {
        updates.iva_porcentaje = it.iva_porcentaje ?? ivaDefault;
      }

      const { error: syncErr } = await supabase
        .from('producto')
        .update(updates)
        .eq('id', res.producto_id)
        .eq('tenant_id', tenantId);

      if (syncErr) {
        console.error('[confirmacion-importado] sync catalogo desde factura:', syncErr.message);
      }
    }
  }

  const { data: productos, error: prodErr } = await supabase
    .from('producto')
    .select('id, codigo, nombre, iva_porcentaje, precio_costo, precio_venta, descuento_costo_pct')
    .eq('tenant_id', tenantId)
    .in('id', productoIds);

  if (prodErr || !productos || productos.length !== productoIds.length) {
    return { ok: false, status: 400, error: 'Uno o más productos no existen' };
  }

  const prodMap = new Map(productos.map((p) => [p.id, p]));

  const itemsCalc = resolvedItems.map((it) => ({
    producto_id: it.producto_id,
    cantidad: it.cantidad,
    precio_unitario: it.precio_unitario,
    iva_porcentaje: prodMap.get(it.producto_id)?.iva_porcentaje ?? ivaDefault,
  }));

  const precioNetoEnLineas =
    body.tipo_operacion === 'compra' &&
    (origen === 'manual' || body.precios_items_con_iva_incluido !== true);
  const importesCalculados = calcularImportes(
    itemsCalc,
    body.tipo_comprobante,
    ivaDefault,
    precioNetoEnLineas,
  );
  const percepcionesTotal = totalPercepcionesFactura(body);
  const totalPreferidoSinPercepciones =
    body.total != null ? round2(Math.max(0, body.total - percepcionesTotal)) : null;
  /** Si la cabecera fue revisada a mano, respetamos subtotal/IVA/total exactos. */
  const usarImportesCabecera = body.importes_manuales === true;
  const importesBase =
    usarImportesCabecera
      ? importesDesdeCabeceraManual(body, importesCalculados)
      : importesPreferiendoTotalInformado(importesCalculados, totalPreferidoSinPercepciones);
  const importes =
    usarImportesCabecera
      ? importesBase
      : importesConPercepciones(importesBase, percepcionesTotal);

  const tipo = body.tipo_comprobante as TipoComprobante;
  const numero = numeroComprobanteImportado(body.punto_venta, body.numero_documento);

  let dupQuery = supabase
    .from('comprobante')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('estado', 'importado')
    .eq('tipo_operacion', body.tipo_operacion)
    .eq('tipo', tipo);

  if (numero != null) {
    dupQuery = dupQuery.eq('numero', numero);
  }

  if (body.tipo_operacion === 'compra' && proveedorId) {
    dupQuery = dupQuery.eq('proveedor_id', proveedorId);
  } else if (body.tipo_operacion === 'venta' && clienteId) {
    dupQuery = dupQuery.eq('cliente_id', clienteId);
  }

  const { data: dup } = await dupQuery.maybeSingle();
  if (dup) {
    return {
      ok: false,
      status: 409,
      error: 'Ya existe un comprobante importado con el mismo proveedor/cliente y numeración',
    };
  }

  const { data: nOrden, error: nOrdErr } = await supabase.rpc('siguiente_numero_orden', {
    p_tenant_id: tenantId,
  });
  if (nOrdErr || nOrden == null) {
    return { ok: false, status: 500, error: nOrdErr?.message ?? 'Error de numeración' };
  }

  const tag = origen === 'manual' ? 'manual' : 'lector';
  let notasRef = `[${tag}] pv=${body.punto_venta ?? '-'} n=${body.numero_documento ?? '-'}`;
  if (
    body.percepcion_iibb_monto > 0 ||
    body.percepcion_iva_monto > 0 ||
    body.impuesto_interno_monto > 0
  ) {
    notasRef += ` · perc_iibb=${body.percepcion_iibb_monto} perc_iva=${body.percepcion_iva_monto} imp_int=${body.impuesto_interno_monto}`;
  }
  if (body.observaciones?.trim()) {
    notasRef += ` · ${body.observaciones.trim().slice(0, 500)}`;
  }

  const { data: comp, error: compErr } = await supabase
    .from('comprobante')
    .insert({
      tenant_id: tenantId,
      sucursal_id: sucursalId,
      usuario_id: userId,
      cliente_id: body.tipo_operacion === 'venta' ? clienteId : null,
      proveedor_id: body.tipo_operacion === 'compra' ? proveedorId : null,
      tipo,
      tipo_operacion: body.tipo_operacion,
      estado: 'importado',
      fecha: body.fecha,
      numero,
      numero_orden: nOrden,
      subtotal: importes.subtotal,
      iva_porcentaje: importes.iva_porcentaje,
      iva_monto: importes.iva_monto,
      percepcion_iibb_monto: body.percepcion_iibb_monto,
      percepcion_iva_monto: body.percepcion_iva_monto,
      impuesto_interno_monto: body.impuesto_interno_monto,
      total: importes.total,
      cae: body.cae,
      cae_vencimiento: body.cae_vencimiento,
      notas: notasRef,
      pdf_url: null,
    })
    .select('id')
    .single();

  if (compErr || !comp) {
    return {
      ok: false,
      status: 500,
      error: compErr?.message ?? 'No se pudo crear el comprobante',
    };
  }

  const comprobanteId = comp.id;

  for (const it of resolvedItems) {
    const sub = Math.round(it.cantidad * it.precio_unitario * 100) / 100;
    const { error: itErr } = await supabase.from('comprobante_item').insert({
      comprobante_id: comprobanteId,
      producto_id: it.producto_id,
      cantidad: it.cantidad,
      precio_unitario: it.precio_unitario,
      precio_costo: it.precio_costo,
      subtotal: sub,
    });
    if (itErr) {
      await supabase.from('comprobante').delete().eq('id', comprobanteId);
      return { ok: false, status: 500, error: itErr.message };
    }
  }

  if (body.afecta_stock) {
    const esNotaCredito = esTipoNotaCredito(body.tipo_comprobante);
    // Una NC invierte el sentido del stock respecto de la factura asociada:
    // - NC recibida (compra)  → salida (devolución a proveedor)
    // - NC emitida  (venta)   → entrada (cliente devolvió mercadería)
    const esEntrada = esNotaCredito
      ? body.tipo_operacion === 'venta'
      : body.tipo_operacion === 'compra';
    const refTipo = esEntrada ? 'factura_recibida' : 'factura_importada';
    const tipoMov = esEntrada ? 'entrada' : 'salida';
    const sufijoOrigen = origen === 'manual' ? 'manual' : 'IA';
    const motivoEntrada = esNotaCredito
      ? `Entrada por NC emitida (${sufijoOrigen})`
      : `Entrada por factura recibida (${sufijoOrigen})`;
    const motivoSalida = esNotaCredito
      ? `Salida por NC recibida (${sufijoOrigen})`
      : `Salida por factura importada (${sufijoOrigen})`;

    for (const it of resolvedItems) {
      const { data: movRow, error: movErr } = await supabase.rpc('registrar_movimiento', {
        p_tenant_id: tenantId,
        p_producto_id: it.producto_id,
        p_sucursal_id: sucursalId,
        p_tipo: tipoMov,
        p_cantidad: it.cantidad,
        p_motivo: esEntrada ? motivoEntrada : motivoSalida,
        p_referencia_tipo: refTipo,
        p_referencia_id: comprobanteId,
        p_usuario_id: userId,
        p_proveedor_id: esEntrada && !esNotaCredito ? (proveedorId ?? null) : null,
      });
      if (movErr) {
        return { ok: false, status: 400, error: `Stock: ${movErr.message}` };
      }

      // Lote por ingreso para compras: deja rastro de cantidad/costo/proveedor de cada entrada.
      // Las NC no registran lote: una devolución no representa un nuevo ingreso de mercadería.
      if (esEntrada && registrarLotesLF && !esNotaCredito) {
        const movimientoId = (movRow as { id: string } | null)?.id ?? null;
        const { error: loteErr } = await registrarLoteIngreso(supabase, {
          tenantId,
          productoId: it.producto_id,
          sucursalId,
          proveedorId: proveedorId ?? null,
          cantidad: it.cantidad,
          fechaVencimiento: null,
          precioCosto: it.precio_costo,
          origen: 'lector_facturas',
          lectorFacturaLogId: body.log_id ?? null,
          movimientoId,
          creadoPor: userId,
        });
        if (loteErr) {
          console.error('[confirmacion-importado] producto_lote_ingreso:', loteErr);
        }
      }
    }
  }

  if (body.afecta_cuenta_corriente && importes.total > 0) {
    // Las NC invierten el signo del saldo: reducen lo que se debe (proveedor) o lo que nos deben (cliente).
    const esNotaCreditoCC = esTipoNotaCredito(body.tipo_comprobante);
    const deltaSaldo = esNotaCreditoCC ? -importes.total : importes.total;
    try {
      if (body.tipo_operacion === 'compra' && proveedorId) {
        const saldoCuentaProveedor = await incrementarSaldoCuentaProveedor(
          supabase,
          tenantId,
          proveedorId,
          deltaSaldo,
        );

        // Una NC recibida no genera obligación de pago nueva: es un crédito a favor.
        const trackearOblProveedor =
          body.direccion === 'recibida' &&
          body.tipo_operacion === 'compra' &&
          proveedorId &&
          !esNotaCreditoCC;

        if (trackearOblProveedor) {
          const { data: provRow, error: provErr } = await supabase
            .from('proveedor')
            .select('condicion_pago_default, plazo_pago_dias')
            .eq('id', proveedorId)
            .eq('tenant_id', tenantId)
            .maybeSingle();

          if (provErr) {
            throw new Error(provErr.message);
          }

          const pagoE = resuelvePagoProveedorEfectivo(body, provRow);
          const provC = proveedorRowACond(provRow);
          if (
            pagoE.estado === 'pendiente_condicion' &&
            !proveedorTieneCondicionPagoCargada(provC)
          ) {
            return {
              ok: false,
              status: 400,
              error:
                'Cargá la condición de pago en la ficha del proveedor o elegí “fecha personalizada”.',
            };
          }

          let vencDia: string;
          let condicion: CondicionPagoProveedorDb;
          try {
            const r = calcularVencimientoDia({
              estado: pagoE.estado,
              fechaFacturaYmd: body.fecha.slice(0, 10),
              proveedor: provC,
              vencimientoCustomYmd:
                pagoE.estado === 'pendiente_fecha_custom' ? pagoE.vencimiento_at : null,
              fechaPagoYmd: pagoE.estado === 'ya_pagada' ? pagoE.fecha_pago : null,
            });
            vencDia = r.vencimientoDiaYmd;
            condicion = r.condicion;
          } catch (ve) {
            return { ok: false, status: 400, error: (ve as Error).message };
          }

          const vencAt = vencimientoTimestamptzDesdeDia(vencDia);
          const saldoPendienteInicial = calcularSaldoPendienteNuevoCargo(
            saldoCuentaProveedor.saldoNuevo,
            importes.total,
          );
          const estadoInicial =
            saldoPendienteInicial <= 0
              ? 'pagada'
              : saldoPendienteInicial < importes.total - 0.01
                ? 'parcial'
                : 'pendiente';

          const { data: ppIns, error: ppErr } = await supabase
            .from('pago_proveedor_factura')
            .insert({
              tenant_id: tenantId,
              comprobante_id: comprobanteId,
              proveedor_id: proveedorId,
              monto_original: importes.total,
              saldo_pendiente: saldoPendienteInicial,
              vencimiento_at: vencAt,
              condicion_pago: condicion,
              estado: estadoInicial,
              origen: 'comprobante',
            })
            .select('id')
            .single();

          if (ppErr || !ppIns) {
            throw new Error(ppErr?.message ?? 'No se pudo registrar la obligación a proveedor');
          }

          if (pagoE.estado === 'ya_pagada') {
            const tipoP = pagoE.tipo_pago;
            if (!tipoP) {
              return { ok: false, status: 400, error: 'Falta el medio de pago' };
            }
            const tipo: Database['public']['Enums']['tipo_pago'] = tipoP;
            const { error: rpcErr } = await supabase.rpc('registrar_pago_proveedor', {
              p_pago_proveedor_factura_id: ppIns.id,
              p_monto: importes.total,
              p_tipo_pago: tipo,
              p_notas: null,
              p_usuario_id: userId,
              p_fecha: pagoE.fecha_pago,
            });
            if (rpcErr) {
              return { ok: false, status: 400, error: rpcErr.message };
            }
          }
        }
      } else if (body.tipo_operacion === 'venta' && clienteId) {
        await incrementarSaldoCuentaCliente(supabase, tenantId, clienteId, deltaSaldo);
      }
    } catch (e) {
      return { ok: false, status: 500, error: (e as Error).message };
    }
  }

  const actualizacionesCostos: ActualizacionCostoProducto[] = [];

  // Las NC son devoluciones: no representan un nuevo costo de compra.
  const aplicaActualizacionCostos =
    body.actualizar_costos &&
    body.tipo_operacion === 'compra' &&
    !esTipoNotaCredito(body.tipo_comprobante);

  if (aplicaActualizacionCostos) {
    for (const it of resolvedItems) {
      if (esLineaBonificacionOReposicion(it)) {
        continue;
      }
      const prod = prodMap.get(it.producto_id);
      if (!prod) continue;
      const anterior = costoPrevioValido(prod.precio_costo == null ? null : Number(prod.precio_costo));
      const candidatoNuevo = it.precio_costo;
      // Aplica regla "el costo solo sube" cuando la pref está activa.
      const decidido = decidirNuevoCosto(precioCostoSoloSubeLF, anterior, candidatoNuevo);
      const nuevo = decidido ?? anterior;
      if (nuevo == null) continue;
      const ventaAnt = prod.precio_venta == null ? null : Number(prod.precio_venta);
      const actualizacion = construirActualizacionCostoProducto({
        producto_id: it.producto_id,
        codigo: prod.codigo ?? null,
        nombre: prod.nombre ?? null,
        precio_costo_anterior: anterior,
        precio_costo_nuevo: nuevo,
        precio_venta_anterior: ventaAnt,
      });
      if (!actualizacion) continue;

      const { error: upErr } = await supabase
        .from('producto')
        .update({ precio_costo: nuevo })
        .eq('id', it.producto_id)
        .eq('tenant_id', tenantId);
      if (upErr) continue;

      await recalcularPreciosSucursalConGanancia(supabase, {
        tenantId,
        productoId: it.producto_id,
        producto: {
          precio_costo: nuevo,
          iva_porcentaje: prod.iva_porcentaje,
          descuento_costo_pct: prod.descuento_costo_pct,
        },
      });

      const margenAnt =
        anterior != null && anterior > 0 && ventaAnt != null
          ? ((ventaAnt - anterior) / anterior) * 100
          : 0;
      const margenNuevo =
        nuevo > 0 && ventaAnt != null ? ((ventaAnt - nuevo) / nuevo) * 100 : 0;

      await supabase.from('precio_historial').insert({
        tenant_id: tenantId,
        producto_id: it.producto_id,
        precio_costo_anterior: anterior,
        precio_costo_nuevo: nuevo,
        precio_venta_anterior: ventaAnt,
        precio_venta_nuevo: ventaAnt,
        margen_anterior: margenAnt,
        margen_nuevo: margenNuevo,
        origen: 'factura_recibida',
      });

      actualizacionesCostos.push(actualizacion);
      prodMap.set(it.producto_id, { ...prod, precio_costo: nuevo });
    }
  }

  if (body.tipo_operacion === 'compra') {
    const signoDeltaCC = esTipoNotaCredito(body.tipo_comprobante) ? -1 : 1;
    const cuentaCorrienteDelta =
      body.afecta_cuenta_corriente && proveedorId && importes.total > 0
        ? signoDeltaCC * importes.total
        : 0;

    const { data: aplicacion, error: aplicacionErr } = await supabase
      .from('factura_importada_aplicacion')
      .insert({
        tenant_id: tenantId,
        comprobante_id: comprobanteId,
        lector_factura_log_id: body.log_id ?? null,
        origen,
        afecta_stock: body.afecta_stock,
        afecta_cuenta_corriente: body.afecta_cuenta_corriente,
        actualizar_costos: body.actualizar_costos,
        precios_items_con_iva_incluido: body.precios_items_con_iva_incluido === true,
        subtotal: importes.subtotal,
        iva_monto: importes.iva_monto,
        percepcion_iibb_monto: body.percepcion_iibb_monto,
        percepcion_iva_monto: body.percepcion_iva_monto,
        impuesto_interno_monto: body.impuesto_interno_monto,
        total: importes.total,
        cuenta_corriente_delta: cuentaCorrienteDelta,
      })
      .select('id')
      .single();

    if (aplicacionErr || !aplicacion) {
      console.error(
        '[confirmacion-importado] factura_importada_aplicacion:',
        aplicacionErr?.message ?? 'sin fila creada',
      );
    } else if (productoIds.length > 0) {
      const { data: productoRowsAfter, error: productoAfterErr } = await supabase
        .from('producto')
        .select(PRODUCTO_SNAPSHOT_SELECT)
        .eq('tenant_id', tenantId)
        .in('id', productoIds);

      const { data: precioRowsAfter, error: precioAfterErr } = await supabase
        .from('precio_sucursal')
        .select(PRECIO_SUCURSAL_SNAPSHOT_SELECT)
        .eq('tenant_id', tenantId)
        .in('producto_id', productoIds);

      if (productoAfterErr || precioAfterErr) {
        console.error(
          '[confirmacion-importado] snapshot after:',
          productoAfterErr?.message ?? precioAfterErr?.message,
        );
      } else {
        const productoAfterSnapshotById = new Map<string, ProductoCatalogoSnapshot>();
        for (const row of productoRowsAfter ?? []) {
          productoAfterSnapshotById.set(row.id, snapshotProductoCatalogo(row));
        }

        const precioSucursalAfterSnapshotById = new Map<string, PrecioSucursalSnapshot[]>();
        for (const productId of productoIds) {
          precioSucursalAfterSnapshotById.set(
            productId,
            snapshotPreciosSucursal((precioRowsAfter ?? []).filter((row) => row.producto_id === productId)),
          );
        }

        const snapshotRows = productoIds.flatMap((productoId) => {
          const productoAfter = productoAfterSnapshotById.get(productoId);
          if (!productoAfter) return [];
          const precioBefore = precioSucursalBeforeSnapshotById.get(productoId) ?? [];
          const precioAfter = precioSucursalAfterSnapshotById.get(productoId) ?? [];
          return [
            {
              tenant_id: tenantId,
              aplicacion_id: aplicacion.id,
              comprobante_id: comprobanteId,
              producto_id: productoId,
              creado_en_confirmacion: idsProductoAltaEnEstaConfirmacion.has(productoId),
              producto_before: (productoBeforeSnapshotById.get(productoId) ?? null) as Json | null,
              producto_after: productoAfter as unknown as Json,
              producto_after_hash: hashSnapshot(productoAfter),
              precio_sucursal_before: precioBefore as unknown as Json,
              precio_sucursal_after: precioAfter as unknown as Json,
              precio_sucursal_after_hash: hashSnapshot(precioAfter),
            },
          ];
        });

        if (snapshotRows.length > 0) {
          const { error: snapshotErr } = await supabase
            .from('factura_importada_producto_snapshot')
            .insert(snapshotRows);
          if (snapshotErr) {
            console.error('[confirmacion-importado] producto snapshots:', snapshotErr.message);
          }
        }
      }
    }
  }

  if (body.log_id) {
    const { error: logUpErr } = await supabase
      .from('lector_factura_log')
      .update({
        estado: 'confirmado',
        comprobante_id: comprobanteId,
        proveedor_id: proveedorId,
        cliente_id: clienteId,
      })
      .eq('id', body.log_id)
      .eq('tenant_id', tenantId);

    if (logUpErr) {
      console.error('[confirmacion-importado] log update:', logUpErr.message);
    }
  }

  return {
    ok: true,
    comprobante_id: comprobanteId,
    actualizaciones_costos: actualizacionesCostos,
  };
}
