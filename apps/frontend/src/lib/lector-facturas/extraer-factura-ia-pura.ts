import {
  PROMPT_EXTRACCION_FACTURA,
  PROMPT_EXTRACCION_FACTURA_REINTENTO_TABLA,
} from '@/lib/ia/prompts';
import { esErrorExtraccionVisionIA, VisionIAError } from '@/lib/ia/vision-ia-error';
import {
  llamarVisionExtraccionJson,
  type VisionExtraccionMeta,
  type VisionProviderConfig,
} from '@/lib/ia/vision-extraccion';
import {
  parsearJsonFacturaGemini,
  validarTotalesFactura,
  type FacturaGeminiPayload,
} from '@/lib/lector-facturas/extraccion';
import {
  construirHojasFacturaVision,
  fusionarPayloadsFactura,
  MAX_ARCHIVOS_FACTURA_MULTIPAGINA,
  MAX_BYTES_FACTURA_MULTIPAGINA,
  MAX_HOJAS_FACTURA_IA,
  promptFacturaParaHoja,
  resumenHojasFactura,
  validacionFacturaMejora,
  type ArchivoFacturaEntrada,
  type HojaFacturaVision,
} from '@/lib/lector-facturas/multipagina';

export type { ArchivoFacturaEntrada, ArchivoFacturaResumen } from '@/lib/lector-facturas/multipagina';

type ValidacionFactura = ReturnType<typeof validarTotalesFactura>;

export const LECTOR_FACTURA_MIME_TYPES_PERMITIDOS = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const LECTOR_FACTURA_MAX_FILE_SIZE = 20 * 1024 * 1024;

export type FacturaExtractorSource = 'plataforma' | 'api_publica' | 'whatsapp' | 'extractor_publico';

export type FacturaExtractorCleanPayload = {
  archivo_nombre: string;
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
  items: FacturaGeminiPayload['items'];
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
  advertencias: string[];
  multipagina: Record<string, unknown>;
};

export type HojaExtraccionFactura = {
  hoja: HojaFacturaVision;
  texto: string;
  meta: VisionExtraccionMeta | undefined;
  payload: FacturaGeminiPayload;
};

export type ExtraerFacturaIaPuraOk = {
  ok: true;
  payload: FacturaGeminiPayload;
  clean: FacturaExtractorCleanPayload;
  validacion: ValidacionFactura;
  archivoNombre: string;
  archivoMime: string;
  archivoTamano: number;
  hojasResumen: ReturnType<typeof resumenHojasFactura>;
  resultadosOriginales: HojaExtraccionFactura[];
  resultadosReintento: HojaExtraccionFactura[] | null;
  resultadosFinales: HojaExtraccionFactura[];
  reintentoError: string | null;
};

export type ExtraerFacturaIaPuraResult =
  | ExtraerFacturaIaPuraOk
  | {
      ok: false;
      status: number;
      error: string;
      respuesta_raw?: string;
      archivoNombre?: string;
      archivoMime?: string;
      archivoTamano?: number;
      hojasResumen?: ReturnType<typeof resumenHojasFactura>;
      hoja?: HojaFacturaVision;
      texto?: string;
      meta?: VisionExtraccionMeta;
      attempts?: unknown[];
    };

export function archivoNombreLog(archivos: ArchivoFacturaEntrada[]): string {
  const primero = archivos[0]?.name || 'factura';
  if (archivos.length <= 1) return primero;
  return `${primero} (+${archivos.length - 1} archivos)`;
}

export function validarArchivosFacturaIa(archivos: ArchivoFacturaEntrada[]): {
  ok: true;
  totalBytes: number;
} | {
  ok: false;
  status: number;
  error: string;
} {
  if (archivos.length === 0) {
    return { ok: false, status: 400, error: 'No se envio ningun archivo' };
  }

  if (archivos.length > MAX_ARCHIVOS_FACTURA_MULTIPAGINA) {
    return {
      ok: false,
      status: 400,
      error: `No se pueden subir mas de ${MAX_ARCHIVOS_FACTURA_MULTIPAGINA} archivos por factura.`,
    };
  }

  const totalBytes = archivos.reduce((acc, archivo) => acc + archivo.size, 0);
  if (totalBytes > MAX_BYTES_FACTURA_MULTIPAGINA) {
    return { ok: false, status: 400, error: 'La factura completa no puede superar 40 MB' };
  }

  for (const archivo of archivos) {
    if (!LECTOR_FACTURA_MIME_TYPES_PERMITIDOS.includes(archivo.type as (typeof LECTOR_FACTURA_MIME_TYPES_PERMITIDOS)[number])) {
      return {
        ok: false,
        status: 400,
        error: `Formato no soportado: ${archivo.type}. Usa PDF, JPG, PNG o WebP.`,
      };
    }

    if (archivo.size > LECTOR_FACTURA_MAX_FILE_SIZE) {
      return {
        ok: false,
        status: 400,
        error: `El archivo ${archivo.name || 'sin nombre'} no puede superar 20 MB`,
      };
    }
  }

  return { ok: true, totalBytes };
}

type ResultadoHoja =
  | { ok: true; resultado: HojaExtraccionFactura }
  | {
      ok: false;
      error: Error;
      texto?: string;
      meta?: VisionExtraccionMeta;
    };

function requiereRelecturaDeTabla(
  payload: FacturaGeminiPayload,
  validacion: ValidacionFactura,
): boolean {
  const tieneReferenciaImpresa = payload.subtotal != null || payload.total != null;
  return payload.items.length > 0 && tieneReferenciaImpresa && !validacion.items_cuadran;
}

function statusDesdeErrorIA(err: unknown, tieneTextoModelo: boolean): number {
  if (tieneTextoModelo) return 422;
  if (esErrorExtraccionVisionIA(err) && (err.code === 'api_key' || err.code === 'config')) return 503;
  if (esErrorExtraccionVisionIA(err) && err.code === 'timeout') return 504;
  return 502;
}

function errorUsuarioHoja(err: Error, hojaNumero: number, totalHojas: number, tieneTextoModelo: boolean): string {
  if (tieneTextoModelo) {
    return `La IA no devolvio JSON valido en la hoja ${hojaNumero} de ${totalHojas}.`;
  }
  return `Error al procesar la hoja ${hojaNumero} de ${totalHojas}: ${err.message}`;
}

async function extraerHojaFactura(
  hoja: HojaFacturaVision,
  totalHojas: number,
  promptBase: string,
  config: VisionProviderConfig | undefined,
): Promise<ResultadoHoja> {
  let texto: string | undefined;
  let meta: VisionExtraccionMeta | undefined;

  try {
    const r = await llamarVisionExtraccionJson(
      promptFacturaParaHoja(promptBase, hoja, totalHojas),
      { base64: Buffer.from(hoja.bytes).toString('base64'), mimeType: hoja.mimeType },
      { fileName: hoja.label, config },
    );
    texto = r.text;
    meta = r.meta;

    return {
      ok: true,
      resultado: {
        hoja,
        texto,
        meta,
        payload: parsearJsonFacturaGemini(texto),
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err as Error,
      ...(texto != null ? { texto } : {}),
      ...(meta ? { meta } : {}),
    };
  }
}

function toCleanPayload(params: {
  archivoNombre: string;
  payload: FacturaGeminiPayload;
  validacion: ValidacionFactura;
  multipagina: Record<string, unknown>;
}): FacturaExtractorCleanPayload {
  const { payload, validacion } = params;
  return {
    archivo_nombre: params.archivoNombre,
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
    items: payload.items,
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
    advertencias: validacion.advertencias,
    multipagina: params.multipagina,
  };
}

export async function extraerFacturaIaPura(params: {
  archivos: ArchivoFacturaEntrada[];
  source: FacturaExtractorSource;
  visionConfig?: VisionProviderConfig;
}): Promise<ExtraerFacturaIaPuraResult> {
  const { archivos } = params;
  const validacionArchivos = validarArchivosFacturaIa(archivos);
  if (!validacionArchivos.ok) return validacionArchivos;

  const archivoNombre = archivoNombreLog(archivos);
  const archivoMime = archivos.length === 1 ? archivos[0]!.type : 'multipart/mixed';
  const archivoTamano = validacionArchivos.totalBytes;
  const hojas = await construirHojasFacturaVision(archivos);
  const hojasResumen = resumenHojasFactura(hojas);

  if (hojas.length > MAX_HOJAS_FACTURA_IA) {
    return {
      ok: false,
      status: 400,
      error: `La factura tiene ${hojas.length} hojas. El maximo por extraccion es ${MAX_HOJAS_FACTURA_IA}.`,
      archivoNombre,
      archivoMime,
      archivoTamano,
      hojasResumen,
    };
  }

  const resultadosOriginales: HojaExtraccionFactura[] = [];
  for (const hoja of hojas) {
    const r = await extraerHojaFactura(hoja, hojas.length, PROMPT_EXTRACCION_FACTURA, params.visionConfig);
    if (!r.ok) {
      const mensaje = errorUsuarioHoja(r.error, hoja.indice + 1, hojas.length, r.texto != null);
      const attempts = r.error instanceof VisionIAError ? r.error.attempts : undefined;
      return {
        ok: false,
        status: statusDesdeErrorIA(r.error, r.texto != null),
        error: mensaje,
        ...(r.texto ? { respuesta_raw: r.texto.substring(0, 500), texto: r.texto } : {}),
        ...(r.meta ? { meta: r.meta } : {}),
        ...(attempts?.length ? { attempts } : {}),
        archivoNombre,
        archivoMime,
        archivoTamano,
        hojasResumen,
        hoja,
      };
    }
    resultadosOriginales.push(r.resultado);
  }

  let resultadosFinales = resultadosOriginales;
  let resultadosReintento: HojaExtraccionFactura[] | null = null;
  let reintentoError: string | null = null;
  let payload = fusionarPayloadsFactura(resultadosOriginales.map((r) => r.payload));
  let validacion = validarTotalesFactura(payload);

  if (requiereRelecturaDeTabla(payload, validacion)) {
    try {
      const retry: HojaExtraccionFactura[] = [];
      for (const hoja of hojas) {
        const r = await extraerHojaFactura(
          hoja,
          hojas.length,
          PROMPT_EXTRACCION_FACTURA_REINTENTO_TABLA,
          params.visionConfig,
        );
        if (!r.ok) throw r.error;
        retry.push(r.resultado);
      }

      const payloadReintento = fusionarPayloadsFactura(retry.map((r) => r.payload));
      const validacionReintento = validarTotalesFactura(payloadReintento);
      resultadosReintento = retry;

      if (validacionFacturaMejora(validacion, validacionReintento)) {
        resultadosFinales = retry;
        payload = payloadReintento;
        validacion = validacionReintento;
      }
    } catch (retryErr) {
      reintentoError = (retryErr as Error).message;
      console.warn('[extraerFacturaIaPura] reintento de tabla no concluyente:', reintentoError);
    }
  }

  const multipagina = {
    total_archivos: archivos.length,
    total_hojas: hojas.length,
    hojas: hojasResumen,
    reintento_usado: resultadosFinales === resultadosReintento,
    ...(reintentoError ? { reintento_error: reintentoError } : {}),
  };

  return {
    ok: true,
    payload,
    clean: toCleanPayload({ archivoNombre, payload, validacion, multipagina }),
    validacion,
    archivoNombre,
    archivoMime,
    archivoTamano,
    hojasResumen,
    resultadosOriginales,
    resultadosReintento,
    resultadosFinales,
    reintentoError,
  };
}
