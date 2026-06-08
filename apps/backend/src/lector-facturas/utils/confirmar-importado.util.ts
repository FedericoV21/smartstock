import {
  proveedorTieneCondicionPagoCargada,
  vencimientoDefaultPersonalizado,
} from '../../importaciones/utils/pago-proveedor-vencimiento.util';

export const TIPOS_PERMITIDOS_CONFIRMAR_IMPORTADO = new Set([
  'factura_a',
  'factura_b',
  'factura_c',
  'nota_credito_a',
  'nota_credito_b',
  'nota_credito_c',
  'remito',
  'ticket',
]);

export function esTipoNotaCredito(tipo: string): boolean {
  return tipo.startsWith('nota_credito');
}

export function comprobanteActualizaIvaProducto(tipo: string): boolean {
  return tipo !== 'remito';
}

export function preciosItemsConIvaIncluidoAplican(tipo: string, solicitado: boolean): boolean {
  return solicitado && comprobanteActualizaIvaProducto(tipo);
}

export type PagoProveedorInput =
  | { estado: 'ya_pagada'; fecha_pago: string; tipo_pago: string }
  | { estado: 'pendiente_condicion' }
  | { estado: 'pendiente_fecha_custom'; vencimiento_at: string };

const ESTADOS_PAGO_PROVEEDOR = new Set<string>([
  'ya_pagada',
  'pendiente_condicion',
  'pendiente_fecha_custom',
]);

const TIPOS_PAGO = new Set<string>(['efectivo', 'transferencia', 'cheque', 'tarjeta', 'otro']);

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
    return { estado, fecha_pago: fp, tipo_pago: tp };
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

export type ItemConfirmarImportadoIn = {
  producto_id: string | null;
  crear_desde_factura: { nombre: string; codigo: string | null } | null;
  cantidad: number;
  precio_unitario: number;
  precio_costo: number;
  iva_porcentaje: number | null;
  unidad_factura: string | null;
  descripcion_factura?: string | null;
  codigo_factura?: string | null;
  presentacion_modo?: 'auto' | 'unidad_base' | 'presentacion_compra';
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
  observaciones: string | null;
  fecha_vencimiento_sugerida: string | null;
  pago: PagoProveedorInput | null;
  inferir_presentacion_compra_desde_nombre?: boolean;
  precios_items_con_iva_incluido?: boolean;
  importes_manuales?: boolean;
  sucursal_id?: string | null;
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
  )
    return null;
  if (
    subtotal < 0 ||
    iva_monto < 0 ||
    percepcion_iibb_monto < 0 ||
    percepcion_iva_monto < 0 ||
    impuesto_interno_monto < 0 ||
    total < 0
  )
    return null;

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
  const fvSug =
    typeof b.fecha_vencimiento_sugerida === 'string' ? b.fecha_vencimiento_sugerida : null;
  const sucursal_id =
    typeof b.sucursal_id === 'string' && b.sucursal_id.trim() ? b.sucursal_id.trim() : null;

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
    sucursal_id,
  };
}

export function validarItemsConfirmarImportado(body: ConfirmarImportadoBody): string | null {
  if (body.items.length === 0) return 'Debe haber al menos un ítem';
  if (body.tipo_operacion === 'venta') {
    for (const it of body.items) {
      if (!it.producto_id) {
        return 'En ventas, todos los ítems deben tener un producto del catálogo.';
      }
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

export function validarCombinacionConfirmar(body: ConfirmarImportadoBody): string | null {
  if (!TIPOS_PERMITIDOS_CONFIRMAR_IMPORTADO.has(body.tipo_comprobante)) {
    return `tipo_comprobante no soportado (${body.tipo_comprobante})`;
  }
  if (body.tipo_operacion === 'compra' && body.direccion === 'emitida') {
    return 'Compra emitida no soportada';
  }
  if (body.tipo_operacion === 'venta' && body.direccion === 'recibida') {
    return 'Venta recibida no soportada';
  }
  if (body.tipo_operacion === 'compra' && !body.proveedor_id && !body.crear_proveedor) {
    return 'Factura de compra: indicá o creá un proveedor';
  }
  if (body.tipo_operacion === 'venta' && !body.cliente_id && !body.crear_cliente) {
    return 'Factura de venta: indicá o creá un cliente';
  }
  if (body.tipo_operacion === 'venta' && body.crear_proveedor) {
    return 'crear_proveedor no aplica en venta';
  }
  if (body.tipo_operacion === 'compra' && body.crear_cliente) {
    return 'crear_cliente no aplica en compra';
  }
  if (body.pago != null && body.tipo_operacion !== 'compra') {
    return 'pago a proveedor solo aplica en compras';
  }
  if (body.pago != null && body.direccion !== 'recibida') {
    return 'pago a proveedor solo aplica en facturas recibidas';
  }
  return null;
}

export function resuelvePagoProveedorEfectivo(
  body: ConfirmarImportadoBody,
  prov: { condicion_pago_default: string; plazo_pago_dias: number | null } | null,
): PagoProveedorInput {
  if (body.pago) return body.pago;
  const fechaF = body.fecha.slice(0, 10);
  const c = prov
    ? {
        condicionPagoDefault: prov.condicion_pago_default === 'dias' ? ('dias' as const) : ('contado' as const),
        plazoPagoDias: prov.plazo_pago_dias,
      }
    : null;
  if (proveedorTieneCondicionPagoCargada(c)) {
    return { estado: 'pendiente_condicion' };
  }
  return {
    estado: 'pendiente_fecha_custom',
    vencimiento_at: vencimientoDefaultPersonalizado(fechaF, body.fecha_vencimiento_sugerida),
  };
}
