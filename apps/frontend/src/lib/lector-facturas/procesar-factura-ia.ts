import type { SupabaseClient } from '@supabase/supabase-js';

import { matchearItemsPrevia } from '@/lib/analizador/matching';
import { verificarLimiteIA } from '@/lib/ia/limite';
import { detectarDireccion } from '@/lib/lector-facturas/direccion';
import {
  facturaItemsAMatcheables,
  validarTotalesFactura,
  type FacturaGeminiPayload,
} from '@/lib/lector-facturas/extraccion';
import {
  archivoNombreLog,
  extraerFacturaIaPura,
  validarArchivosFacturaIa,
  type HojaExtraccionFactura,
  type ArchivoFacturaEntrada,
  type ArchivoFacturaResumen,
} from '@/lib/lector-facturas/extraer-factura-ia-pura';
import { lectorFacturaExtraccionPermitida } from '@/lib/lector-facturas/rate-limit';
import { subirArchivoFacturaRecibida } from '@/lib/lector-facturas/storage';
import type { Database, Json } from '@/types/database';

export type { ArchivoFacturaEntrada } from '@/lib/lector-facturas/multipagina';
export {
  archivoNombreLog,
  LECTOR_FACTURA_MAX_FILE_SIZE,
  LECTOR_FACTURA_MIME_TYPES_PERMITIDOS,
  validarArchivosFacturaIa,
} from '@/lib/lector-facturas/extraer-factura-ia-pura';

type ValidacionFactura = ReturnType<typeof validarTotalesFactura>;

export type ProcesarFacturaIaSource = 'plataforma' | 'api_publica' | 'whatsapp';

export type LectorFacturaPreviewPayload = {
  log_id: string;
  iva_default: number;
  direccion: 'recibida' | 'emitida' | 'desconocida';
  cabecera: {
    tipo_comprobante: string;
    letra: string | null;
    punto_venta: number | null;
    numero: number | null;
    fecha_emision: string | null;
    fecha_vencimiento: string | null;
    cae: string | null;
    cae_vencimiento: string | null;
  };
  emisor: FacturaGeminiPayload['emisor'];
  receptor: FacturaGeminiPayload['receptor'];
  proveedor: { id: string; nombre: string } | null;
  cliente: { id: string; nombre: string } | null;
  crear_proveedor: { razon_social: string; cuit: string } | null;
  crear_cliente: { razon_social: string; cuit_dni: string } | null;
  items: Array<{
    indice: number;
    codigo: string | null;
    descripcion: string;
    cantidad: number;
    unidad: string | null;
    precio_unitario: number;
    bonificacion: number | null;
    subtotal: number;
    iva_porcentaje: number;
    producto_unidad: string | null;
    producto_unidad_compra: string | null;
    producto_contenido_unidad_compra: number | null;
    match: {
      producto_id: string | null;
      confidence: number;
      metodo: string;
      producto_nombre: string | null;
      requires_review: boolean;
    };
  }>;
  totales: {
    subtotal: number | null;
    iva_21: number | null;
    iva_10_5: number | null;
    iva_27: number | null;
    percepcion_iibb: number | null;
    percepcion_iva: number | null;
    impuesto_interno: number | null;
    otros_impuestos: number | null;
    total: number | null;
  };
  condicion_pago: string | null;
  observaciones: string | null;
  validacion: ValidacionFactura;
  multipagina: Record<string, unknown>;
  archivo_nombre: string;
  extracciones_restantes: number | null;
};

export type ProcesarFacturaIaResult =
  | { ok: true; payload: LectorFacturaPreviewPayload }
  | { ok: false; status: number; error: string; respuesta_raw?: string };


function parseJsonParaLog(texto: string): unknown {
  try {
    return JSON.parse(texto) as unknown;
  } catch {
    return { raw: texto.slice(0, 50_000) };
  }
}

function hojaLog(hoja: HojaExtraccionFactura['hoja']) {
  return {
    indice: hoja.indice,
    archivoIndice: hoja.archivoIndice,
    archivoNombre: hoja.archivoNombre,
    pagina: hoja.pagina,
    paginasArchivo: hoja.paginasArchivo,
    label: hoja.label,
  };
}

function resultadoHojaLog(r: HojaExtraccionFactura) {
  return {
    hoja: hojaLog(r.hoja),
    raw: r.texto.slice(0, 50_000),
    json: parseJsonParaLog(r.texto),
    _ia: r.meta,
  };
}

function sourceLabel(source: ProcesarFacturaIaSource): string {
  if (source === 'api_publica') return 'API factura';
  if (source === 'whatsapp') return 'WhatsApp factura';
  return 'IA factura';
}

function matchRequiresReview(match: {
  producto_id: string | null;
  confidence: number;
  metodo: string;
}): boolean {
  if (!match.producto_id || match.metodo === 'sin_match') return true;
  return match.confidence < 0.8;
}

export async function procesarFacturaIa(params: {
  supabase: SupabaseClient<Database>;
  tenantId: string;
  userId: string;
  archivos: ArchivoFacturaEntrada[];
  source: ProcesarFacturaIaSource;
  aplicarRateLimit?: boolean;
  aplicarLimiteMensual?: boolean;
}): Promise<ProcesarFacturaIaResult> {
  const {
    supabase,
    tenantId,
    userId,
    archivos,
    source,
    aplicarRateLimit = true,
    aplicarLimiteMensual = true,
  } = params;

  if (aplicarRateLimit && !lectorFacturaExtraccionPermitida(tenantId)) {
    return {
      ok: false,
      status: 429,
      error: 'Demasiadas extracciones en poco tiempo. Espera un minuto e intenta de nuevo.',
    };
  }

  let limiteInfo: Awaited<ReturnType<typeof verificarLimiteIA>> = {
    permitido: true,
    usadas: 0,
    limite: null,
  };
  if (aplicarLimiteMensual) {
    try {
      limiteInfo = await verificarLimiteIA(supabase, tenantId, 'lector_factura');
    } catch (e) {
      return { ok: false, status: 500, error: (e as Error).message };
    }

    if (!limiteInfo.permitido) {
      return { ok: false, status: 429, error: 'Limite mensual de extracciones IA alcanzado' };
    }
  }

  const validacionArchivos = validarArchivosFacturaIa(archivos);
  if (!validacionArchivos.ok) return validacionArchivos;
  const totalBytes = validacionArchivos.totalBytes;

  const archivosGuardados: ArchivoFacturaResumen[] = [];
  for (let i = 0; i < archivos.length; i++) {
    const archivo = archivos[i]!;
    const { path: storagePath, error: upErr } = await subirArchivoFacturaRecibida(
      supabase,
      tenantId,
      archivo.bytes,
      archivo.name,
      archivo.type,
    );

    if (upErr) {
      return { ok: false, status: 500, error: `No se pudo guardar el archivo: ${upErr.message}` };
    }

    archivosGuardados.push({
      indice: i,
      nombre: archivo.name,
      mimeType: archivo.type,
      size: archivo.size,
      storagePath,
    });
  }

  const storagePathPrincipal = archivosGuardados[0]?.storagePath ?? '';
  const nombreLog = archivoNombreLog(archivos);
  const mimeLog = archivos.length === 1 ? archivos[0]!.type : 'multipart/mixed';

  const extraccion = await extraerFacturaIaPura({ archivos, source });
  if (!extraccion.ok) {
    await supabase.from('lector_factura_log').insert({
      tenant_id: tenantId,
      usuario_id: userId,
      archivo_url: storagePathPrincipal,
      archivo_nombre: nombreLog,
      archivo_mime: mimeLog,
      archivo_tamano: totalBytes,
      gemini_raw: {
        error: true,
        source,
        mensaje: extraccion.error,
        archivos: archivosGuardados,
        hojas: extraccion.hojasResumen ?? [],
        ...(extraccion.hoja ? { hoja: hojaLog(extraccion.hoja) } : {}),
        ...(extraccion.texto ? { raw: extraccion.texto.slice(0, 50_000) } : {}),
        ...(extraccion.meta ? { _ia: extraccion.meta } : {}),
        ...(extraccion.attempts?.length ? { attempts: extraccion.attempts } : {}),
      } as Json,
      datos_extraidos: null,
      direccion: 'desconocida',
      estado: 'error',
      error_mensaje: extraccion.error,
    });
    return {
      ok: false,
      status: extraccion.status,
      error: extraccion.error,
      ...(extraccion.respuesta_raw ? { respuesta_raw: extraccion.respuesta_raw } : {}),
    };
  }

  const payload = extraccion.payload;
  const validacion = extraccion.validacion;
  const resultadosOriginales = extraccion.resultadosOriginales;
  const resultadosReintento = extraccion.resultadosReintento;
  const resultadosFinales = extraccion.resultadosFinales;
  const reintentoError = extraccion.reintentoError;
  const hojasResumen = extraccion.hojasResumen;

  const { data: tenantRow } = await supabase
    .from('tenant')
    .select('cuit, iva_porcentaje_default')
    .eq('id', tenantId)
    .maybeSingle();

  const tenantCuit = tenantRow?.cuit ?? null;
  const ivaDefaultTenant = tenantRow?.iva_porcentaje_default ?? 21;

  const { error: logExErr } = await supabase.from('importacion_log').insert({
    tenant_id: tenantId,
    proveedor_id: null,
    archivo_nombre: `[${sourceLabel(source)}] ${nombreLog}`,
    origen: 'lector_factura',
    total_filas: payload.items.length,
    filas_exitosas: payload.items.length,
    filas_con_error: 0,
    productos_creados: 0,
    productos_actualizados: 0,
    detalle_errores: null,
    usuario_id: userId,
  });
  if (logExErr) {
    console.error('[procesarFacturaIa] importacion_log:', logExErr.message);
  }

  const direccionInfo = await detectarDireccion(
    supabase,
    tenantId,
    tenantCuit,
    payload.emisor.cuit,
    payload.receptor.cuit_dni,
    payload.emisor.razon_social,
    payload.receptor.razon_social,
  );

  const { data: productos } = await supabase
    .from('producto')
    .select('id, codigo, nombre, iva_porcentaje, unidad, unidad_compra, contenido_unidad_compra')
    .eq('activo', true)
    .eq('tenant_id', tenantId);

  const ivaPorProducto = new Map(
    (productos ?? []).map((p) => [p.id, p.iva_porcentaje as number | null]),
  );
  const unidadPorProducto = new Map((productos ?? []).map((p) => [p.id, p.unidad as string]));
  const unidadCompraPorProducto = new Map(
    (productos ?? []).map((p) => [p.id, p.unidad_compra as string | null]),
  );
  const contenidoUnidadCompraPorProducto = new Map(
    (productos ?? []).map((p) => [p.id, p.contenido_unidad_compra as number | null]),
  );

  const catalogo = (productos ?? []).map((p) => ({
    id: p.id,
    codigo: p.codigo,
    nombre: p.nombre,
  }));

  const matcheables = facturaItemsAMatcheables(payload.items);
  const { porItemId } = await matchearItemsPrevia(supabase, matcheables, catalogo, {
    tenantId,
    userId,
    logMatchingArchivo: `[IA matching] ${sourceLabel(source)} ${tenantId.slice(0, 8)} ${Date.now()}`,
    origenLog: 'lector_factura',
    codigoDuplicadoEstrategia: 'elegir_primero_por_id',
  });

  const itemsResp = payload.items.map((it, indice) => {
    const mid = `fact-${indice}`;
    const m = porItemId.get(mid)!;
    const pid = m.producto_id;
    const ivaPct = pid != null ? (ivaPorProducto.get(pid) ?? ivaDefaultTenant) : ivaDefaultTenant;
    const match = {
      producto_id: m.producto_id,
      confidence: m.confidence,
      metodo: m.metodo,
      producto_nombre: m.producto_nombre,
      requires_review: matchRequiresReview(m),
    };
    return {
      indice,
      codigo: it.codigo,
      descripcion: it.descripcion,
      cantidad: it.cantidad,
      unidad: it.unidad,
      precio_unitario: it.precio_unitario,
      bonificacion: it.bonificacion,
      subtotal: it.subtotal,
      iva_porcentaje: ivaPct,
      producto_unidad: pid != null ? unidadPorProducto.get(pid) ?? null : null,
      producto_unidad_compra: pid != null ? unidadCompraPorProducto.get(pid) ?? null : null,
      producto_contenido_unidad_compra:
        pid != null ? contenidoUnidadCompraPorProducto.get(pid) ?? null : null,
      match,
    };
  });

  let proveedorPayload: { id: string; nombre: string } | null = null;
  if (direccionInfo.proveedor_id) {
    const { data: p } = await supabase
      .from('proveedor')
      .select('id, nombre')
      .eq('id', direccionInfo.proveedor_id)
      .maybeSingle();
    proveedorPayload = p ? { id: p.id, nombre: p.nombre } : null;
  }

  let clientePayload: { id: string; nombre: string } | null = null;
  if (direccionInfo.cliente_id) {
    const { data: c } = await supabase
      .from('cliente')
      .select('id, nombre')
      .eq('id', direccionInfo.cliente_id)
      .maybeSingle();
    clientePayload = c ? { id: c.id, nombre: c.nombre } : null;
  }

  const multipaginaLog = {
    total_archivos: archivos.length,
    total_hojas: hojasResumen.length,
    archivos: archivosGuardados,
    hojas: hojasResumen,
    reintento_usado: resultadosFinales === resultadosReintento,
    ...(reintentoError ? { reintento_error: reintentoError } : {}),
  };

  const datosExtraidos = {
    direccion: direccionInfo.direccion,
    cabecera: {
      tipo_comprobante: payload.tipo_comprobante,
      letra: payload.letra,
      punto_venta: payload.punto_venta,
      numero: payload.numero,
      fecha_emision: payload.fecha_emision,
      fecha_vencimiento: payload.fecha_vencimiento,
      cae: payload.cae,
      cae_vencimiento: payload.cae_vencimiento,
    },
    emisor: payload.emisor,
    receptor: payload.receptor,
    proveedor_id: direccionInfo.proveedor_id,
    cliente_id: direccionInfo.cliente_id,
    items: itemsResp,
    totales: {
      subtotal: payload.subtotal,
      iva_21: payload.iva_21,
      iva_10_5: payload.iva_10_5,
      iva_27: payload.iva_27,
      percepcion_iibb: payload.percepcion_iibb,
      percepcion_iva: payload.percepcion_iva,
      impuesto_interno: payload.impuesto_interno,
      otros_impuestos: payload.otros_impuestos,
      total: payload.total,
    },
    condicion_pago: payload.condicion_pago,
    observaciones: payload.observaciones,
    validacion,
    multipagina: multipaginaLog,
  };

  const geminiRawPayload: Json = {
    _multipagina: multipaginaLog,
    source,
    hojas: resultadosOriginales.map(resultadoHojaLog),
    ...(resultadosReintento ? { reintento_hojas: resultadosReintento.map(resultadoHojaLog) } : {}),
    payload_final: payload as unknown as Json,
  } as Json;

  const { data: logRow, error: logInsErr } = await supabase
    .from('lector_factura_log')
    .insert({
      tenant_id: tenantId,
      usuario_id: userId,
      archivo_url: storagePathPrincipal,
      archivo_nombre: nombreLog,
      archivo_mime: mimeLog,
      archivo_tamano: totalBytes,
      gemini_raw: geminiRawPayload,
      datos_extraidos: datosExtraidos as Json,
      direccion: direccionInfo.direccion,
      estado: 'extraido',
      proveedor_id: direccionInfo.proveedor_id,
      cliente_id: direccionInfo.cliente_id,
    })
    .select('id')
    .single();

  if (logInsErr) {
    console.error('[procesarFacturaIa] lector_factura_log:', logInsErr.message);
    return { ok: false, status: 500, error: 'No se pudo guardar el registro de extraccion' };
  }

  let limiteFinal: Awaited<ReturnType<typeof verificarLimiteIA>>;
  if (aplicarLimiteMensual) {
    try {
      limiteFinal = await verificarLimiteIA(supabase, tenantId, 'lector_factura');
    } catch {
      limiteFinal = { permitido: true, usadas: limiteInfo.usadas, limite: limiteInfo.limite };
    }
  } else {
    limiteFinal = { permitido: true, usadas: limiteInfo.usadas, limite: limiteInfo.limite };
  }

  const extraccionesRestantes =
    limiteFinal.limite == null ? null : Math.max(0, limiteFinal.limite - limiteFinal.usadas);

  return {
    ok: true,
    payload: {
      log_id: logRow.id,
      iva_default: ivaDefaultTenant,
      direccion: direccionInfo.direccion,
      cabecera: datosExtraidos.cabecera,
      emisor: payload.emisor,
      receptor: payload.receptor,
      proveedor: proveedorPayload,
      cliente: clientePayload,
      crear_proveedor: direccionInfo.crear_proveedor,
      crear_cliente: direccionInfo.crear_cliente,
      items: itemsResp,
      totales: datosExtraidos.totales,
      condicion_pago: payload.condicion_pago,
      observaciones: payload.observaciones,
      validacion,
      multipagina: multipaginaLog,
      archivo_nombre: nombreLog,
      extracciones_restantes: extraccionesRestantes,
    },
  };
}
