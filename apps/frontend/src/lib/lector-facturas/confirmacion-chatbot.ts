import { createHash } from 'node:crypto';

import { effectiveBusinessPrefsFromRows } from '@/lib/business-prefs/prefs';
import {
  calcularImportes,
  importesPreferiendoTotalInformado,
} from '@/lib/facturacion/calcular-importes';
import {
  ActualizacionCostoProducto,
  ConfirmarImportadoBody,
  ItemConfirmarImportadoIn,
  TIPOS_PERMITIDOS_CONFIRMAR_IMPORTADO,
  construirActualizacionCostoProducto,
  ejecutarConfirmacionImportado,
  esLineaBonificacionOReposicion,
  esTipoNotaCredito,
  validarItemsConfirmarImportado,
} from '@/lib/lector-facturas/ejecutar-confirmacion-importado';
import {
  LectorFacturaPreviewPayload,
} from '@/lib/lector-facturas/procesar-factura-ia';
import {
  mapUnidadFacturaTexto,
  normalizarLineaLectorFactura,
} from '@/lib/lector-facturas/normalizar-linea-lector-factura';
import { numeroComprobanteImportado } from '@/lib/lector-facturas/numero-importado';
import { decidirNuevoCosto } from '@/lib/productos/upsert-con-proveedor';

type DbClient = any;

export type LectorFacturaConfirmacionOverrides = {
  actualizar_costos?: boolean;
  afecta_stock?: boolean;
  afecta_cuenta_corriente?: boolean;
  precios_items_con_iva_incluido?: boolean;
  pago?: ConfirmarImportadoBody['pago'];
};

export type LectorFacturaImpacto = {
  resumen: {
    proveedor_nombre: string | null;
    total_items: number;
    productos_vinculados: number;
    productos_nuevos: number;
    productos_para_revisar: number;
    total: number | null;
    afecta_stock: boolean;
    afecta_cuenta_corriente: boolean;
    actualizar_costos: boolean;
  };
  cambios_costos: ActualizacionCostoProducto[];
  advertencias: string[];
  conflictos: string[];
  bloqueantes: string[];
  requiere_confirmacion: boolean;
};

export type PrepararConfirmacionLectorFacturaResult = {
  confirmPayload: ConfirmarImportadoBody;
  impacto: LectorFacturaImpacto;
  impactHash: string;
};

export type LectorFacturaJobAplicacionRow = {
  id: string;
  tenant_id: string;
  sucursal_id: string | null;
  usuario_id: string | null;
  status: string;
  resultado: unknown;
  application_status?: string | null;
  applied_comprobante_id?: string | null;
};

type ProductoImpacto = {
  id: string;
  codigo: string | null;
  nombre: string | null;
  precio_costo: number | null;
  precio_venta: number | null;
  iva_porcentaje: number | null;
  unidad: string | null;
  unidad_compra: string | null;
  contenido_unidad_compra: number | null;
};

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableJson(v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
}

export function hashImpactoLectorFactura(impacto: LectorFacturaImpacto): string {
  return createHash('sha256').update(stableJson(impacto)).digest('hex');
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function finiteNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function positiveCostOrNull(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0.000001) return null;
  return n;
}

function normalizeTipoComprobante(tipo: string | null | undefined, letra: string | null | undefined): string {
  const t = String(tipo ?? '').trim().toLowerCase();
  if (TIPOS_PERMITIDOS_CONFIRMAR_IMPORTADO.has(t)) return t;

  const l = String(letra ?? '').trim().toLowerCase();
  if ((t === 'factura' || t === 'fac') && (l === 'a' || l === 'b' || l === 'c')) return `factura_${l}`;
  if (
    (t === 'nota_credito' || t === 'nota de credito' || t === 'nota_crédito') &&
    (l === 'a' || l === 'b' || l === 'c')
  ) {
    return `nota_credito_${l}`;
  }
  return t || 'desconocido';
}

function cuitValido(value: string | null | undefined): string | null {
  const v = String(value ?? '').replace(/\D/g, '');
  return v.length === 11 ? v : null;
}

function crearProveedorDesdePreview(preview: LectorFacturaPreviewPayload): ConfirmarImportadoBody['crear_proveedor'] {
  const raw = preview.crear_proveedor;
  if (raw?.razon_social && cuitValido(raw.cuit)) {
    return { razon_social: raw.razon_social, cuit: cuitValido(raw.cuit)! };
  }
  const rs = preview.emisor?.razon_social?.trim();
  const cuit = cuitValido(preview.emisor?.cuit);
  return rs && cuit ? { razon_social: rs, cuit } : null;
}

function fechaFactura(preview: LectorFacturaPreviewPayload): string {
  const raw = preview.cabecera.fecha_emision?.trim() ?? '';
  return raw.length >= 10 ? raw.slice(0, 10) : new Date().toISOString().slice(0, 10);
}

function percepcion(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? round2(n) : 0;
}

function impuestoInternoDesdeTotales(totales: LectorFacturaPreviewPayload['totales'] | undefined): number {
  const explicito = percepcion(totales?.impuesto_interno);
  return explicito > 0 ? explicito : percepcion(totales?.otros_impuestos);
}

function precioItemsConIvaIncluidoDefault(tipoComprobante: string, overrides?: LectorFacturaConfirmacionOverrides) {
  if (typeof overrides?.precios_items_con_iva_incluido === 'boolean') {
    return overrides.precios_items_con_iva_incluido;
  }
  return tipoComprobante === 'factura_b';
}

function itemConfirmacionDesdePreview(
  item: LectorFacturaPreviewPayload['items'][number],
): ItemConfirmarImportadoIn {
  const productoId = item.match?.producto_id ?? null;
  const descripcion = item.descripcion?.trim() || 'Item factura';
  const codigo = item.codigo?.trim() || null;
  return {
    producto_id: productoId,
    crear_desde_factura: productoId ? null : { nombre: descripcion, codigo },
    cantidad: finiteNumber(item.cantidad),
    precio_unitario: finiteNumber(item.precio_unitario),
    precio_costo: finiteNumber(item.precio_unitario),
    iva_porcentaje: Number.isFinite(Number(item.iva_porcentaje)) ? Number(item.iva_porcentaje) : null,
    unidad_factura: item.unidad?.trim() || null,
    descripcion_factura: descripcion,
    codigo_factura: codigo,
    presentacion_modo: 'auto',
    contenido_presentacion_compra: item.producto_contenido_unidad_compra ?? null,
  };
}

async function cargarProductosImpacto(
  db: DbClient,
  tenantId: string,
  productIds: string[],
): Promise<Map<string, ProductoImpacto>> {
  const ids = [...new Set(productIds.filter(Boolean))];
  const out = new Map<string, ProductoImpacto>();
  if (ids.length === 0) return out;
  const { data, error } = await db
    .from('producto')
    .select(
      'id, codigo, nombre, precio_costo, precio_venta, iva_porcentaje, unidad, unidad_compra, contenido_unidad_compra',
    )
    .eq('tenant_id', tenantId)
    .in('id', ids);
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    out.set(String(row.id), {
      id: String(row.id),
      codigo: row.codigo ?? null,
      nombre: row.nombre ?? null,
      precio_costo: row.precio_costo == null ? null : Number(row.precio_costo),
      precio_venta: row.precio_venta == null ? null : Number(row.precio_venta),
      iva_porcentaje: row.iva_porcentaje == null ? null : Number(row.iva_porcentaje),
      unidad: row.unidad ?? null,
      unidad_compra: row.unidad_compra ?? null,
      contenido_unidad_compra:
        row.contenido_unidad_compra == null ? null : Number(row.contenido_unidad_compra),
    });
  }
  return out;
}

async function precioCostoSoloSube(db: DbClient, tenantId: string, sucursalId: string | null): Promise<boolean> {
  const { data: tenant } = await db
    .from('tenant')
    .select('business_prefs')
    .eq('id', tenantId)
    .maybeSingle();
  let sucursalPrefs: unknown = null;
  if (sucursalId) {
    const { data } = await db
      .from('sucursal')
      .select('business_prefs')
      .eq('id', sucursalId)
      .maybeSingle();
    sucursalPrefs = data?.business_prefs ?? null;
  }
  return effectiveBusinessPrefsFromRows(tenant?.business_prefs ?? null, sucursalPrefs).precioCostoSoloSube === true;
}

async function existeComprobanteDuplicado(db: DbClient, tenantId: string, body: ConfirmarImportadoBody): Promise<boolean> {
  const numero = numeroComprobanteImportado(body.punto_venta, body.numero_documento);
  let q = db
    .from('comprobante')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('estado', 'importado')
    .eq('tipo_operacion', body.tipo_operacion)
    .eq('tipo', body.tipo_comprobante);

  if (numero != null) q = q.eq('numero', numero);
  if (body.tipo_operacion === 'compra' && body.proveedor_id) {
    q = q.eq('proveedor_id', body.proveedor_id);
  } else if (body.tipo_operacion === 'venta' && body.cliente_id) {
    q = q.eq('cliente_id', body.cliente_id);
  }

  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data?.id);
}

function normalizarLineaParaImpacto(params: {
  item: ItemConfirmarImportadoIn;
  producto: ProductoImpacto | null;
  ivaDefault: number;
  preciosItemsConIvaIncluido: boolean;
}) {
  const unidadStock = params.producto?.unidad
    ? mapUnidadFacturaTexto(params.producto.unidad)
    : mapUnidadFacturaTexto(params.item.unidad_factura);
  return normalizarLineaLectorFactura({
    descripcion_factura: params.item.descripcion_factura ?? '',
    nombre_producto_catalogo: params.producto?.nombre ?? null,
    unidad_factura: params.item.unidad_factura,
    unidad_stock_producto: unidadStock,
    cantidad: params.item.cantidad,
    precio_unitario: params.item.precio_unitario,
    precio_costo_input: params.item.precio_costo,
    inferir_pack: false,
    presentacion_modo: params.item.presentacion_modo ?? 'auto',
    contenido_presentacion_compra:
      params.item.contenido_presentacion_compra ?? params.producto?.contenido_unidad_compra ?? null,
    precios_con_iva_incluido: params.preciosItemsConIvaIncluido,
    iva_porcentaje: params.item.iva_porcentaje,
    iva_default: params.ivaDefault,
  });
}

function construirCambiosCosto(params: {
  body: ConfirmarImportadoBody;
  productos: Map<string, ProductoImpacto>;
  ivaDefault: number;
  preciosItemsConIvaIncluido: boolean;
  costoSoloSube: boolean;
}): ActualizacionCostoProducto[] {
  if (
    !params.body.actualizar_costos ||
    params.body.tipo_operacion !== 'compra' ||
    esTipoNotaCredito(params.body.tipo_comprobante)
  ) {
    return [];
  }

  const cambios: ActualizacionCostoProducto[] = [];
  for (const item of params.body.items) {
    if (!item.producto_id) continue;
    const producto = params.productos.get(item.producto_id) ?? null;
    if (!producto) continue;
    const norm = normalizarLineaParaImpacto({
      item,
      producto,
      ivaDefault: params.ivaDefault,
      preciosItemsConIvaIncluido: params.preciosItemsConIvaIncluido,
    });
    if (esLineaBonificacionOReposicion({ precio_unitario: norm.precio_unitario, precio_costo: norm.precio_costo })) {
      continue;
    }
    const anterior = positiveCostOrNull(producto.precio_costo);
    const decidido = decidirNuevoCosto(params.costoSoloSube, anterior, norm.precio_costo);
    if (decidido == null) continue;
    const cambio = construirActualizacionCostoProducto({
      producto_id: producto.id,
      codigo: producto.codigo,
      nombre: producto.nombre,
      precio_costo_anterior: anterior,
      precio_costo_nuevo: decidido,
      precio_venta_anterior: producto.precio_venta,
    });
    if (cambio) cambios.push(cambio);
  }
  return cambios;
}

function calcularImportesBody(params: {
  bodyBase: Omit<
    ConfirmarImportadoBody,
    | 'subtotal'
    | 'iva_monto'
    | 'percepcion_iibb_monto'
    | 'percepcion_iva_monto'
    | 'impuesto_interno_monto'
    | 'total'
  >;
  preview: LectorFacturaPreviewPayload;
  productos: Map<string, ProductoImpacto>;
  ivaDefault: number;
  preciosItemsConIvaIncluido: boolean;
}) {
  const lineas = params.bodyBase.items.map((item) => {
    const producto = item.producto_id ? params.productos.get(item.producto_id) ?? null : null;
    const norm = normalizarLineaParaImpacto({
      item,
      producto,
      ivaDefault: params.ivaDefault,
      preciosItemsConIvaIncluido: params.preciosItemsConIvaIncluido,
    });
    return {
      producto_id: item.producto_id ?? '_',
      cantidad: norm.cantidad,
      precio_unitario: norm.precio_unitario,
      iva_porcentaje: item.iva_porcentaje ?? params.ivaDefault,
    };
  });

  const precioNetoEnLineas = params.bodyBase.tipo_operacion === 'compra' && !params.preciosItemsConIvaIncluido;
  const importes = calcularImportes(
    lineas,
    params.bodyBase.tipo_comprobante,
    params.ivaDefault,
    precioNetoEnLineas,
  );
  const percepcionIibb = percepcion(params.preview.totales?.percepcion_iibb);
  const percepcionIva = percepcion(params.preview.totales?.percepcion_iva);
  const impuestoInterno = impuestoInternoDesdeTotales(params.preview.totales);
  const totalPercepciones = round2(percepcionIibb + percepcionIva + impuestoInterno);
  const totalLeido = params.preview.totales?.total;
  const totalBaseLeido =
    typeof totalLeido === 'number' && Number.isFinite(totalLeido)
      ? Math.max(0, round2(totalLeido - totalPercepciones))
      : null;
  const base = importesPreferiendoTotalInformado(importes, totalBaseLeido);
  return {
    subtotal: base.subtotal,
    iva_monto: base.iva_monto,
    percepcion_iibb_monto: percepcionIibb,
    percepcion_iva_monto: percepcionIva,
    impuesto_interno_monto: impuestoInterno,
    total: round2(base.total + totalPercepciones),
  };
}

function extractPreview(raw: unknown): LectorFacturaPreviewPayload | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (!obj.log_id || !Array.isArray(obj.items) || !obj.cabecera) return null;
  return obj as unknown as LectorFacturaPreviewPayload;
}

export async function prepararConfirmacionLectorFactura(params: {
  db: DbClient;
  tenantId: string;
  sucursalId: string | null;
  preview: LectorFacturaPreviewPayload;
  overrides?: LectorFacturaConfirmacionOverrides;
}): Promise<PrepararConfirmacionLectorFacturaResult> {
  const { db, tenantId, sucursalId, preview, overrides } = params;
  const tipoComprobante = normalizeTipoComprobante(preview.cabecera.tipo_comprobante, preview.cabecera.letra);
  const preciosItemsConIvaIncluido = precioItemsConIvaIncluidoDefault(tipoComprobante, overrides);
  const items = preview.items.map(itemConfirmacionDesdePreview);
  const productIds = items.map((i) => i.producto_id).filter((id): id is string => Boolean(id));
  const productos = await cargarProductosImpacto(db, tenantId, productIds);

  const { data: tenant } = await db
    .from('tenant')
    .select('iva_porcentaje_default')
    .eq('id', tenantId)
    .maybeSingle();
  const ivaDefault = Number.isFinite(Number(tenant?.iva_porcentaje_default))
    ? Number(tenant.iva_porcentaje_default)
    : preview.iva_default ?? 21;

  const bodyBase: Omit<
    ConfirmarImportadoBody,
    | 'subtotal'
    | 'iva_monto'
    | 'percepcion_iibb_monto'
    | 'percepcion_iva_monto'
    | 'impuesto_interno_monto'
    | 'total'
  > = {
    log_id: preview.log_id,
    direccion: 'recibida',
    proveedor_id: preview.proveedor?.id ?? null,
    cliente_id: null,
    crear_proveedor: preview.proveedor ? null : crearProveedorDesdePreview(preview),
    crear_cliente: null,
    tipo_comprobante: tipoComprobante,
    tipo_operacion: 'compra',
    fecha: fechaFactura(preview),
    punto_venta: preview.cabecera.punto_venta,
    numero_documento: preview.cabecera.numero,
    cae: preview.cabecera.cae?.trim() || null,
    cae_vencimiento: preview.cabecera.cae_vencimiento?.trim()
      ? preview.cabecera.cae_vencimiento.trim().slice(0, 10)
      : null,
    items,
    actualizar_costos: overrides?.actualizar_costos ?? !esTipoNotaCredito(tipoComprobante),
    afecta_stock: overrides?.afecta_stock ?? true,
    afecta_cuenta_corriente: overrides?.afecta_cuenta_corriente ?? true,
    observaciones: [preview.observaciones, preview.condicion_pago].filter(Boolean).join(' | ') || null,
    fecha_vencimiento_sugerida: preview.cabecera.fecha_vencimiento?.trim()
      ? preview.cabecera.fecha_vencimiento.trim().slice(0, 10)
      : null,
    pago: overrides && 'pago' in overrides ? overrides.pago ?? null : null,
    inferir_presentacion_compra_desde_nombre: false,
    precios_items_con_iva_incluido: preciosItemsConIvaIncluido,
  };

  const importes = calcularImportesBody({
    bodyBase,
    preview,
    productos,
    ivaDefault,
    preciosItemsConIvaIncluido,
  });
  const confirmPayload: ConfirmarImportadoBody = { ...bodyBase, ...importes };
  const bloqueantes: string[] = [];
  const conflictos: string[] = [];
  const advertencias = [...(preview.validacion?.advertencias ?? [])];

  if (!TIPOS_PERMITIDOS_CONFIRMAR_IMPORTADO.has(confirmPayload.tipo_comprobante)) {
    bloqueantes.push(`Tipo de comprobante no confirmable: ${confirmPayload.tipo_comprobante || 'desconocido'}`);
  }
  const itemsError = validarItemsConfirmarImportado(confirmPayload);
  if (itemsError) bloqueantes.push(itemsError);
  if (!confirmPayload.proveedor_id && !confirmPayload.crear_proveedor) {
    bloqueantes.push('No se pudo determinar proveedor para la compra.');
  }
  if (sucursalId == null) {
    bloqueantes.push('No hay sucursal operativa asociada al job.');
  }
  if (await existeComprobanteDuplicado(db, tenantId, confirmPayload)) {
    bloqueantes.push('Ya existe un comprobante importado con el mismo proveedor y numeracion.');
  }

  const productosParaRevisar = preview.items.filter((item) => item.match?.requires_review).length;
  const productosNuevos = preview.items.filter((item) => !item.match?.producto_id).length;
  if (productosParaRevisar > 0) conflictos.push(`${productosParaRevisar} producto(s) requieren revision de match.`);
  if (productosNuevos > 0) conflictos.push(`${productosNuevos} producto(s) se crearan desde la factura.`);
  if (preview.validacion?.items_cuadran === false || preview.validacion?.totales_cuadran === false) {
    conflictos.push('Los importes extraidos no cuadran completamente con la factura.');
  }
  if (advertencias.length > 0) conflictos.push('La extraccion IA contiene advertencias.');

  const cambiosCostos = construirCambiosCosto({
    body: confirmPayload,
    productos,
    ivaDefault,
    preciosItemsConIvaIncluido,
    costoSoloSube: await precioCostoSoloSube(db, tenantId, sucursalId),
  });
  if (cambiosCostos.length > 0) {
    conflictos.push(`${cambiosCostos.length} costo(s) de catalogo cambiaran.`);
  }

  const impacto: LectorFacturaImpacto = {
    resumen: {
      proveedor_nombre: preview.proveedor?.nombre ?? preview.crear_proveedor?.razon_social ?? preview.emisor?.razon_social ?? null,
      total_items: preview.items.length,
      productos_vinculados: preview.items.filter((item) => item.match?.producto_id).length,
      productos_nuevos: productosNuevos,
      productos_para_revisar: productosParaRevisar,
      total: typeof preview.totales?.total === 'number' ? preview.totales.total : confirmPayload.total,
      afecta_stock: confirmPayload.afecta_stock,
      afecta_cuenta_corriente: confirmPayload.afecta_cuenta_corriente,
      actualizar_costos: confirmPayload.actualizar_costos,
    },
    cambios_costos: cambiosCostos,
    advertencias,
    conflictos,
    bloqueantes,
    requiere_confirmacion: true,
  };

  return {
    confirmPayload,
    impacto,
    impactHash: hashImpactoLectorFactura(impacto),
  };
}

export async function prepararConfirmacionLectorFacturaDesdeResultado(params: {
  db: DbClient;
  tenantId: string;
  sucursalId: string | null;
  resultado: unknown;
  overrides?: LectorFacturaConfirmacionOverrides;
}): Promise<PrepararConfirmacionLectorFacturaResult> {
  const preview = extractPreview(params.resultado);
  if (!preview) throw new Error('Resultado de job sin preview valido.');
  return prepararConfirmacionLectorFactura({
    db: params.db,
    tenantId: params.tenantId,
    sucursalId: params.sucursalId,
    preview,
    overrides: params.overrides,
  });
}

export async function aplicarConfirmacionLectorFacturaJob(params: {
  db: DbClient;
  tenantId: string;
  job: LectorFacturaJobAplicacionRow;
  sucursalId: string | null;
  userId: string;
  acceptedImpactHash: string;
  overrides?: LectorFacturaConfirmacionOverrides;
}): Promise<
  | {
      ok: true;
      comprobante_id: string;
      actualizaciones_costos: ActualizacionCostoProducto[];
      impacto: LectorFacturaImpacto;
      impact_hash: string;
      idempotent_replay: boolean;
    }
  | { ok: false; status: number; error: string; impacto?: LectorFacturaImpacto; impact_hash?: string; bloqueantes?: string[] }
> {
  const { db, tenantId, job } = params;
  if (job.status !== 'completed') {
    return { ok: false, status: 409, error: 'El job todavia no esta completado.' };
  }
  if (job.applied_comprobante_id || job.application_status === 'applied') {
    return {
      ok: true,
      comprobante_id: String(job.applied_comprobante_id ?? ''),
      actualizaciones_costos: [],
      impacto: {
        resumen: {
          proveedor_nombre: null,
          total_items: 0,
          productos_vinculados: 0,
          productos_nuevos: 0,
          productos_para_revisar: 0,
          total: null,
          afecta_stock: false,
          afecta_cuenta_corriente: false,
          actualizar_costos: false,
        },
        cambios_costos: [],
        advertencias: [],
        conflictos: [],
        bloqueantes: [],
        requiere_confirmacion: false,
      },
      impact_hash: '',
      idempotent_replay: true,
    };
  }

  const prepared = await prepararConfirmacionLectorFacturaDesdeResultado({
    db,
    tenantId,
    sucursalId: params.sucursalId,
    resultado: job.resultado,
    overrides: params.overrides,
  });
  if (prepared.impacto.bloqueantes.length > 0) {
    await db
      .from('lector_factura_job')
      .update({
        application_status: 'blocked',
        impacto_preview: prepared.impacto,
        impact_hash: prepared.impactHash,
        confirm_payload: prepared.confirmPayload,
        applied_error: prepared.impacto.bloqueantes.join(' | '),
      })
      .eq('id', job.id)
      .eq('tenant_id', tenantId);
    return {
      ok: false,
      status: 409,
      error: 'La factura tiene bloqueantes antes de cargar.',
      impacto: prepared.impacto,
      impact_hash: prepared.impactHash,
      bloqueantes: prepared.impacto.bloqueantes,
    };
  }

  if (params.acceptedImpactHash !== prepared.impactHash) {
    return {
      ok: false,
      status: 428,
      error: 'Confirmacion requerida con accepted_impact_hash vigente.',
      impacto: prepared.impacto,
      impact_hash: prepared.impactHash,
    };
  }

  await db
    .from('lector_factura_job')
    .update({
      application_status: 'applying',
      impacto_preview: prepared.impacto,
      impact_hash: prepared.impactHash,
      confirm_payload: prepared.confirmPayload,
      applied_error: null,
    })
    .eq('id', job.id)
    .eq('tenant_id', tenantId);

  const result = await ejecutarConfirmacionImportado(
    db,
    tenantId,
    params.sucursalId!,
    params.userId,
    prepared.confirmPayload,
    'lector',
  );
  if (!result.ok) {
    await db
      .from('lector_factura_job')
      .update({
        application_status: 'error',
        applied_error: result.error,
      })
      .eq('id', job.id)
      .eq('tenant_id', tenantId);
    return { ok: false, status: result.status, error: result.error, impacto: prepared.impacto, impact_hash: prepared.impactHash };
  }

  await db
    .from('lector_factura_job')
    .update({
      application_status: 'applied',
      applied_comprobante_id: result.comprobante_id,
      applied_at: new Date().toISOString(),
      applied_error: null,
      impacto_preview: prepared.impacto,
      impact_hash: prepared.impactHash,
      confirm_payload: prepared.confirmPayload,
    })
    .eq('id', job.id)
    .eq('tenant_id', tenantId);

  return {
    ok: true,
    comprobante_id: result.comprobante_id,
    actualizaciones_costos: result.actualizaciones_costos,
    impacto: prepared.impacto,
    impact_hash: prepared.impactHash,
    idempotent_replay: false,
  };
}

function formatAmount(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '$0,00';
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(value);
}

export function resumenImpactoLectorFactura(impacto: LectorFacturaImpacto, impactHash: string, token?: string): string {
  const r = impacto.resumen;
  const lines = [
    'Factura lista para revisar.',
    r.proveedor_nombre ? `Proveedor: ${r.proveedor_nombre}` : null,
    `Items: ${r.total_items}. Vinculados: ${r.productos_vinculados}. Nuevos: ${r.productos_nuevos}. Para revisar: ${r.productos_para_revisar}.`,
    `Total: ${formatAmount(r.total)}`,
    `Actualiza stock: ${r.afecta_stock ? 'si' : 'no'}. Cuenta corriente: ${r.afecta_cuenta_corriente ? 'si' : 'no'}. Costos: ${r.actualizar_costos ? 'si' : 'no'}.`,
    impacto.cambios_costos.length > 0
      ? `Cambios de costo: ${impacto.cambios_costos
          .slice(0, 5)
          .map((c) => `${c.nombre} ${formatAmount(c.precio_costo_anterior)} -> ${formatAmount(c.precio_costo_nuevo)}`)
          .join(' | ')}${impacto.cambios_costos.length > 5 ? ' | ...' : ''}`
      : null,
    impacto.conflictos.length > 0 ? `A revisar: ${impacto.conflictos.slice(0, 3).join(' ')}` : null,
    impacto.bloqueantes.length > 0 ? `No puedo cargarla aun: ${impacto.bloqueantes.join(' ')}` : null,
    token && impacto.bloqueantes.length === 0 ? `Para cargarla responde: OK ${token}` : null,
    token && impacto.bloqueantes.length === 0 ? 'Para cancelar responde: cancelar' : null,
    `Hash impacto: ${impactHash.slice(0, 12)}`,
  ];
  return lines.filter(Boolean).join('\n');
}

export function resumenAplicacionLectorFactura(params: {
  comprobanteId: string;
  actualizacionesCostos: ActualizacionCostoProducto[];
}): string {
  const lines = [
    `Factura cargada. Comprobante: ${params.comprobanteId}.`,
    params.actualizacionesCostos.length > 0
      ? `Costos actualizados: ${params.actualizacionesCostos.length}.`
      : 'No se actualizaron costos existentes.',
  ];
  return lines.join('\n');
}
