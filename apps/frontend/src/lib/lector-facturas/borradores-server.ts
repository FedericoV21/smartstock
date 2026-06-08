import type { TenantSession } from '@/lib/api/tenant-session';
import type {
  LectorFacturaBorradorDraft,
  LectorFacturaBorradorListItem,
  LectorFacturaBorradorPayloadV1,
  LectorFacturaBorradorTipoOperacion,
} from '@/lib/lector-facturas/borradores';
import type { LectorFacturaPreviewPayload } from '@/lib/lector-facturas/procesar-factura-ia';
import { hoyEnAR } from '@/lib/utils/formatters';

type ActiveSession = Exclude<TenantSession, { error: unknown }>;
type JsonRecord = Record<string, unknown>;

export function uuidOk(id: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(id);
}

export function esAdminBorradoresLector(session: ActiveSession): boolean {
  return session.isSuperAdmin || session.rol === 'admin';
}

function isRecord(v: unknown): v is JsonRecord {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function relationOne(raw: unknown): JsonRecord | null {
  if (Array.isArray(raw)) return isRecord(raw[0]) ? raw[0] : null;
  return isRecord(raw) ? raw : null;
}

function stringOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

function numberOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function boolOr(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function numInput(n: unknown): string {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n.toFixed(2) : '';
}

function sumaIvaInput(totales: LectorFacturaPreviewPayload['totales']): string {
  const suma = [totales.iva_21, totales.iva_10_5, totales.iva_27]
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0)
    .reduce((acc, n) => acc + n, 0);
  return numInput(suma);
}

function cuitDigits(v: unknown): string {
  return String(v ?? '').replace(/\D/g, '');
}

function validacionVacia(): LectorFacturaPreviewPayload['validacion'] {
  return {
    totales_cuadran: false,
    advertencias: ['Borrador recuperado sin validacion completa de totales.'],
    items_cuadran: false,
    suma_items: 0,
    referencia_items: null,
    diferencia_items: null,
  };
}

function crearProveedorDesdeEmisor(
  emisor: LectorFacturaPreviewPayload['emisor'],
): LectorFacturaPreviewPayload['crear_proveedor'] {
  const razonSocial = String(emisor.razon_social ?? '').trim();
  const cuit = cuitDigits(emisor.cuit);
  if (!razonSocial || cuit.length !== 11) return null;
  return { razon_social: razonSocial, cuit };
}

function crearClienteDesdeReceptor(
  receptor: LectorFacturaPreviewPayload['receptor'],
): LectorFacturaPreviewPayload['crear_cliente'] {
  const razonSocial = String(receptor.razon_social ?? '').trim();
  const cuitDni = cuitDigits(receptor.cuit_dni);
  if (!razonSocial || cuitDni.length !== 11) return null;
  return { razon_social: razonSocial, cuit_dni: cuitDni };
}

function parseDireccion(raw: unknown): LectorFacturaPreviewPayload['direccion'] {
  return raw === 'recibida' || raw === 'emitida' || raw === 'desconocida'
    ? raw
    : 'desconocida';
}

function parseTipoOperacion(raw: unknown, direccion: string): LectorFacturaBorradorTipoOperacion {
  if (raw === 'compra' || raw === 'venta') return raw;
  return direccion === 'emitida' ? 'venta' : 'compra';
}

function parseEmisor(raw: unknown): LectorFacturaPreviewPayload['emisor'] {
  const r = isRecord(raw) ? raw : {};
  return {
    razon_social: String(r.razon_social ?? ''),
    cuit: String(r.cuit ?? ''),
    domicilio: String(r.domicilio ?? ''),
    condicion_iva: String(r.condicion_iva ?? ''),
    ingresos_brutos: String(r.ingresos_brutos ?? ''),
    inicio_actividades: String(r.inicio_actividades ?? ''),
  };
}

function parseReceptor(raw: unknown): LectorFacturaPreviewPayload['receptor'] {
  const r = isRecord(raw) ? raw : {};
  return {
    razon_social: String(r.razon_social ?? ''),
    cuit_dni: String(r.cuit_dni ?? ''),
    domicilio: String(r.domicilio ?? ''),
    condicion_iva: String(r.condicion_iva ?? ''),
  };
}

function parseCabecera(raw: unknown): LectorFacturaPreviewPayload['cabecera'] {
  const r = isRecord(raw) ? raw : {};
  return {
    tipo_comprobante: String(r.tipo_comprobante ?? 'factura_b'),
    letra: stringOrNull(r.letra),
    punto_venta: numberOrNull(r.punto_venta),
    numero: numberOrNull(r.numero),
    fecha_emision: stringOrNull(r.fecha_emision),
    fecha_vencimiento: stringOrNull(r.fecha_vencimiento),
    cae: stringOrNull(r.cae),
    cae_vencimiento: stringOrNull(r.cae_vencimiento),
  };
}

function parseTotales(raw: unknown): LectorFacturaPreviewPayload['totales'] {
  const r = isRecord(raw) ? raw : {};
  return {
    subtotal: numberOrNull(r.subtotal),
    iva_21: numberOrNull(r.iva_21),
    iva_10_5: numberOrNull(r.iva_10_5),
    iva_27: numberOrNull(r.iva_27),
    percepcion_iibb: numberOrNull(r.percepcion_iibb),
    percepcion_iva: numberOrNull(r.percepcion_iva),
    impuesto_interno: numberOrNull(r.impuesto_interno),
    otros_impuestos: numberOrNull(r.otros_impuestos),
    total: numberOrNull(r.total),
  };
}

function parseValidacion(raw: unknown): LectorFacturaPreviewPayload['validacion'] {
  if (!isRecord(raw)) return validacionVacia();
  return {
    ...raw,
    totales_cuadran: boolOr(raw.totales_cuadran, false),
    advertencias: Array.isArray(raw.advertencias)
      ? raw.advertencias.map(String)
      : [],
  } as LectorFacturaPreviewPayload['validacion'];
}

function parseItems(raw: unknown): LectorFacturaPreviewPayload['items'] {
  return Array.isArray(raw) ? (raw as LectorFacturaPreviewPayload['items']) : [];
}

function parseProveedor(row: JsonRecord): LectorFacturaPreviewPayload['proveedor'] {
  const proveedor = relationOne(row.proveedor);
  const id = stringOrNull(row.proveedor_id);
  const nombre = proveedor ? stringOrNull(proveedor.nombre) : null;
  return id && nombre ? { id, nombre } : null;
}

function parseCliente(row: JsonRecord): LectorFacturaPreviewPayload['cliente'] {
  const cliente = relationOne(row.cliente);
  const id = stringOrNull(row.cliente_id);
  const nombre =
    cliente ? stringOrNull(cliente.nombre) ?? stringOrNull(cliente.razon_social) : null;
  return id && nombre ? { id, nombre } : null;
}

export function validarPayloadBorradorLector(
  payload: unknown,
): LectorFacturaBorradorPayloadV1 {
  if (!isRecord(payload)) throw new Error('Payload de borrador invalido');
  if (payload.version !== 1) throw new Error('Version de borrador invalida');
  if (payload.paso !== 'preview') throw new Error('Paso de borrador invalido');
  if (typeof payload.archivoNombre !== 'string') throw new Error('Archivo de borrador invalido');
  if (payload.previewPaso !== 1 && payload.previewPaso !== 2) {
    throw new Error('Paso de preview invalido');
  }
  if (!isRecord(payload.extraccion)) throw new Error('Extraccion de borrador invalida');
  if (typeof payload.extraccion.log_id !== 'string') {
    throw new Error('Log de borrador invalido');
  }
  if (!isRecord(payload.draft)) throw new Error('Draft de borrador invalido');
  const draft = payload.draft as JsonRecord;
  if (!isRecord(draft.cabecera)) throw new Error('Cabecera de borrador invalida');
  if (!isRecord(draft.emisor)) throw new Error('Emisor de borrador invalido');
  if (!isRecord(draft.receptor)) throw new Error('Receptor de borrador invalido');
  if (!Array.isArray(draft.items)) throw new Error('Items de borrador invalidos');
  if (draft.tipoOperacion !== 'compra' && draft.tipoOperacion !== 'venta') {
    throw new Error('Tipo de operacion invalido');
  }
  return payload as LectorFacturaBorradorPayloadV1;
}

export function payloadGuardadoDesdeDatos(
  datosExtraidos: unknown,
): LectorFacturaBorradorPayloadV1 | null {
  if (!isRecord(datosExtraidos)) return null;
  const raw = datosExtraidos.borrador_payload;
  if (!raw) return null;
  try {
    return validarPayloadBorradorLector(raw);
  } catch {
    return null;
  }
}

export function extraccionDesdeLog(
  row: JsonRecord,
  ivaDefault: number,
): LectorFacturaPreviewPayload {
  const datos = isRecord(row.datos_extraidos) ? row.datos_extraidos : {};
  const emisor = parseEmisor(datos.emisor);
  const receptor = parseReceptor(datos.receptor);
  const proveedor = parseProveedor(row);
  const cliente = parseCliente(row);
  const direccion = parseDireccion(datos.direccion ?? row.direccion);

  return {
    log_id: String(row.id ?? ''),
    iva_default: ivaDefault,
    direccion,
    cabecera: parseCabecera(datos.cabecera),
    emisor,
    receptor,
    proveedor,
    cliente,
    crear_proveedor: proveedor ? null : crearProveedorDesdeEmisor(emisor),
    crear_cliente: cliente ? null : crearClienteDesdeReceptor(receptor),
    items: parseItems(datos.items),
    totales: parseTotales(datos.totales),
    condicion_pago: stringOrNull(datos.condicion_pago),
    observaciones: stringOrNull(datos.observaciones),
    validacion: parseValidacion(datos.validacion),
    multipagina: isRecord(datos.multipagina) ? datos.multipagina : {},
    archivo_nombre: String(row.archivo_nombre ?? 'factura'),
    extracciones_restantes: null,
  };
}

export function payloadBorradorDesdeLog(
  row: JsonRecord,
  ivaDefault: number,
): LectorFacturaBorradorPayloadV1 {
  const guardado = payloadGuardadoDesdeDatos(row.datos_extraidos);
  if (guardado && guardado.extraccion.log_id === row.id) return guardado;

  const extraccion = extraccionDesdeLog(row, ivaDefault);
  const tipoOperacion = parseTipoOperacion(null, extraccion.direccion);
  const hoy = hoyEnAR();
  const draft: LectorFacturaBorradorDraft = {
    cabecera: extraccion.cabecera,
    emisor: extraccion.emisor,
    receptor: extraccion.receptor,
    items: extraccion.items,
    tipoOperacion,
    proveedorElegidoId: extraccion.proveedor?.id ?? null,
    clienteElegidoId: extraccion.cliente?.id ?? null,
    incluirCrearProveedor: Boolean(extraccion.crear_proveedor) && !extraccion.proveedor,
    incluirCrearCliente: Boolean(extraccion.crear_cliente) && !extraccion.cliente,
    actualizarCostos: tipoOperacion === 'compra',
    afectaStock: true,
    inferirPresentacionCompra: false,
    preciosItemsConIvaIncluido: extraccion.cabecera.tipo_comprobante === 'factura_b',
    ivaMontoFactura: sumaIvaInput(extraccion.totales),
    percepcionIibb: numInput(extraccion.totales.percepcion_iibb),
    percepcionIva: numInput(extraccion.totales.percepcion_iva),
    impuestoInterno: numInput(extraccion.totales.impuesto_interno ?? extraccion.totales.otros_impuestos),
    afectaCuentaCorriente: true,
    pagoModo: 'pendiente_condicion',
    fechaPagoYa: hoy,
    tipoPagoYa: 'efectivo',
    vencCustom: hoy,
  };

  return {
    version: 1,
    paso: 'preview',
    archivoNombre: extraccion.archivo_nombre,
    previewPaso: 1,
    extraccion,
    draft,
  };
}

export function datosExtraidosConPayloadBorrador(
  datosExtraidos: unknown,
  payload: LectorFacturaBorradorPayloadV1,
): JsonRecord {
  const base = isRecord(datosExtraidos) ? { ...datosExtraidos } : {};
  return {
    ...base,
    borrador_payload: payload as unknown as JsonRecord,
    borrador_guardado_at: new Date().toISOString(),
  };
}

export function mapLectorFacturaBorradorListItem(row: JsonRecord): LectorFacturaBorradorListItem {
  const guardado = payloadGuardadoDesdeDatos(row.datos_extraidos);
  const datos = isRecord(row.datos_extraidos) ? row.datos_extraidos : {};
  const draft = guardado?.draft;
  const cabecera = draft?.cabecera ?? parseCabecera(datos.cabecera);
  const items = draft?.items ?? parseItems(datos.items);
  const direccion = parseDireccion(datos.direccion ?? row.direccion);
  const tipoOperacion = parseTipoOperacion(draft?.tipoOperacion, direccion);
  const proveedor = relationOne(row.proveedor);
  const cliente = relationOne(row.cliente);
  const usuario = relationOne(row.usuario);

  return {
    id: String(row.id ?? ''),
    archivo_nombre: String(row.archivo_nombre ?? guardado?.archivoNombre ?? 'factura'),
    archivo_mime: stringOrNull(row.archivo_mime),
    archivo_tamano:
      typeof row.archivo_tamano === 'number' && Number.isFinite(row.archivo_tamano)
        ? row.archivo_tamano
        : null,
    total_items: items.length,
    tipo_comprobante: cabecera.tipo_comprobante ?? null,
    tipo_operacion: tipoOperacion,
    direccion,
    proveedor_id: stringOrNull(row.proveedor_id),
    cliente_id: stringOrNull(row.cliente_id),
    usuario_id: stringOrNull(row.usuario_id),
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
    guardado: Boolean(guardado),
    proveedor: proveedor ? { nombre: String(proveedor.nombre ?? '') } : null,
    cliente: cliente
      ? {
          nombre: stringOrNull(cliente.nombre),
          razon_social: stringOrNull(cliente.razon_social),
        }
      : null,
    usuario: usuario
      ? {
          nombre: stringOrNull(usuario.nombre),
          email: stringOrNull(usuario.email),
        }
      : null,
  };
}

export function metadataUpdateDesdePayload(payload: LectorFacturaBorradorPayloadV1): {
  direccion: 'recibida' | 'emitida';
  proveedor_id: string | null;
  cliente_id: string | null;
} {
  const esCompra = payload.draft.tipoOperacion === 'compra';
  const proveedorId = payload.draft.proveedorElegidoId;
  const clienteId = payload.draft.clienteElegidoId;
  return {
    direccion: esCompra ? 'recibida' : 'emitida',
    proveedor_id: esCompra && proveedorId && uuidOk(proveedorId) ? proveedorId : null,
    cliente_id: !esCompra && clienteId && uuidOk(clienteId) ? clienteId : null,
  };
}
