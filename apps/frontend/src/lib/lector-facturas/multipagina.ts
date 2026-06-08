import { PDFDocument } from 'pdf-lib';

import {
  validarTotalesFactura,
  type FacturaGeminiPayload,
} from '@/lib/lector-facturas/extraccion';

export const MAX_ARCHIVOS_FACTURA_MULTIPAGINA = 10;
export const MAX_HOJAS_FACTURA_IA = 20;
export const MAX_BYTES_FACTURA_MULTIPAGINA = 40 * 1024 * 1024;

export type ArchivoFacturaEntrada = {
  name: string;
  type: string;
  size: number;
  bytes: Uint8Array;
};

export type HojaFacturaVision = {
  indice: number;
  archivoIndice: number;
  archivoNombre: string;
  mimeType: string;
  bytes: Uint8Array;
  pagina: number | null;
  paginasArchivo: number | null;
  label: string;
};

export type ArchivoFacturaResumen = {
  indice: number;
  nombre: string;
  mimeType: string;
  size: number;
  storagePath?: string;
};

const PAYLOAD_FACTURA_VACIO: FacturaGeminiPayload = {
  tipo_comprobante: 'desconocido',
  letra: null,
  punto_venta: null,
  numero: null,
  fecha_emision: null,
  fecha_vencimiento: null,
  emisor: {
    razon_social: null,
    cuit: null,
    domicilio: null,
    condicion_iva: null,
    ingresos_brutos: null,
    inicio_actividades: null,
  },
  receptor: {
    razon_social: null,
    cuit_dni: null,
    domicilio: null,
    condicion_iva: null,
  },
  items: [],
  subtotal: null,
  iva_21: null,
  iva_10_5: null,
  iva_27: null,
  percepcion_iibb: null,
  percepcion_iva: null,
  impuesto_interno: null,
  otros_impuestos: null,
  total: null,
  condicion_pago: null,
  cae: null,
  cae_vencimiento: null,
  observaciones: null,
};

function clonarPayloadVacio(): FacturaGeminiPayload {
  return {
    ...PAYLOAD_FACTURA_VACIO,
    emisor: { ...PAYLOAD_FACTURA_VACIO.emisor },
    receptor: { ...PAYLOAD_FACTURA_VACIO.receptor },
    items: [],
  };
}

function valorTexto(v: string | null): string | null {
  const t = v?.trim();
  return t ? t : null;
}

function primeroTexto(payloads: FacturaGeminiPayload[], pick: (p: FacturaGeminiPayload) => string | null): string | null {
  for (const p of payloads) {
    const v = valorTexto(pick(p));
    if (v) return v;
  }
  return null;
}

function primeroNumero(payloads: FacturaGeminiPayload[], pick: (p: FacturaGeminiPayload) => number | null): number | null {
  for (const p of payloads) {
    const v = pick(p);
    if (v != null && Number.isFinite(v)) return v;
  }
  return null;
}

function ultimoTexto(payloads: FacturaGeminiPayload[], pick: (p: FacturaGeminiPayload) => string | null): string | null {
  for (let i = payloads.length - 1; i >= 0; i--) {
    const v = valorTexto(pick(payloads[i]!));
    if (v) return v;
  }
  return null;
}

function ultimoNumero(payloads: FacturaGeminiPayload[], pick: (p: FacturaGeminiPayload) => number | null): number | null {
  for (let i = payloads.length - 1; i >= 0; i--) {
    const v = pick(payloads[i]!);
    if (v != null && Number.isFinite(v)) return v;
  }
  return null;
}

function tipoComprobantePrincipal(payloads: FacturaGeminiPayload[]): string {
  const tipo = primeroTexto(payloads, (p) =>
    p.tipo_comprobante && p.tipo_comprobante !== 'desconocido' ? p.tipo_comprobante : null,
  );
  return tipo ?? 'desconocido';
}

export function fusionarPayloadsFactura(payloads: FacturaGeminiPayload[]): FacturaGeminiPayload {
  if (payloads.length === 0) return clonarPayloadVacio();

  return {
    tipo_comprobante: tipoComprobantePrincipal(payloads),
    letra: primeroTexto(payloads, (p) => p.letra),
    punto_venta: primeroNumero(payloads, (p) => p.punto_venta),
    numero: primeroNumero(payloads, (p) => p.numero),
    fecha_emision: primeroTexto(payloads, (p) => p.fecha_emision),
    fecha_vencimiento: primeroTexto(payloads, (p) => p.fecha_vencimiento),
    emisor: {
      razon_social: primeroTexto(payloads, (p) => p.emisor.razon_social),
      cuit: primeroTexto(payloads, (p) => p.emisor.cuit),
      domicilio: primeroTexto(payloads, (p) => p.emisor.domicilio),
      condicion_iva: primeroTexto(payloads, (p) => p.emisor.condicion_iva),
      ingresos_brutos: primeroTexto(payloads, (p) => p.emisor.ingresos_brutos),
      inicio_actividades: primeroTexto(payloads, (p) => p.emisor.inicio_actividades),
    },
    receptor: {
      razon_social: primeroTexto(payloads, (p) => p.receptor.razon_social),
      cuit_dni: primeroTexto(payloads, (p) => p.receptor.cuit_dni),
      domicilio: primeroTexto(payloads, (p) => p.receptor.domicilio),
      condicion_iva: primeroTexto(payloads, (p) => p.receptor.condicion_iva),
    },
    items: payloads.flatMap((p) => p.items.map((it) => ({ ...it }))),
    subtotal: ultimoNumero(payloads, (p) => p.subtotal),
    iva_21: ultimoNumero(payloads, (p) => p.iva_21),
    iva_10_5: ultimoNumero(payloads, (p) => p.iva_10_5),
    iva_27: ultimoNumero(payloads, (p) => p.iva_27),
    percepcion_iibb: ultimoNumero(payloads, (p) => p.percepcion_iibb),
    percepcion_iva: ultimoNumero(payloads, (p) => p.percepcion_iva),
    impuesto_interno: ultimoNumero(payloads, (p) => p.impuesto_interno),
    otros_impuestos: ultimoNumero(payloads, (p) => p.otros_impuestos),
    total: ultimoNumero(payloads, (p) => p.total),
    condicion_pago: ultimoTexto(payloads, (p) => p.condicion_pago),
    cae: ultimoTexto(payloads, (p) => p.cae),
    cae_vencimiento: ultimoTexto(payloads, (p) => p.cae_vencimiento),
    observaciones: ultimoTexto(payloads, (p) => p.observaciones),
  };
}

async function dividirPdfEnHojas(archivo: ArchivoFacturaEntrada, archivoIndice: number): Promise<HojaFacturaVision[]> {
  try {
    const pdf = await PDFDocument.load(archivo.bytes, { ignoreEncryption: true });
    const paginasArchivo = pdf.getPageCount();
    if (paginasArchivo <= 0) {
      return [{
        indice: 0,
        archivoIndice,
        archivoNombre: archivo.name,
        mimeType: archivo.type,
        bytes: archivo.bytes,
        pagina: 1,
        paginasArchivo: 0,
        label: archivo.name,
      }];
    }

    const hojas: HojaFacturaVision[] = [];
    const base = archivo.name.trim().replace(/\.pdf$/i, '') || 'factura';
    for (let i = 0; i < paginasArchivo; i++) {
      const dst = await PDFDocument.create();
      const [page] = await dst.copyPages(pdf, [i]);
      dst.addPage(page);
      hojas.push({
        indice: 0,
        archivoIndice,
        archivoNombre: archivo.name,
        mimeType: archivo.type,
        bytes: await dst.save(),
        pagina: i + 1,
        paginasArchivo,
        label: `${base}-hoja-${i + 1}-de-${paginasArchivo}.pdf`,
      });
    }
    return hojas;
  } catch {
    return [{
      indice: 0,
      archivoIndice,
      archivoNombre: archivo.name,
      mimeType: archivo.type,
      bytes: archivo.bytes,
      pagina: null,
      paginasArchivo: null,
      label: archivo.name,
    }];
  }
}

export async function construirHojasFacturaVision(
  archivos: ArchivoFacturaEntrada[],
): Promise<HojaFacturaVision[]> {
  const hojas: HojaFacturaVision[] = [];

  for (let i = 0; i < archivos.length; i++) {
    const archivo = archivos[i]!;
    if (archivo.type === 'application/pdf') {
      hojas.push(...await dividirPdfEnHojas(archivo, i));
    } else {
      hojas.push({
        indice: 0,
        archivoIndice: i,
        archivoNombre: archivo.name,
        mimeType: archivo.type,
        bytes: archivo.bytes,
        pagina: null,
        paginasArchivo: null,
        label: archivo.name,
      });
    }
  }

  return hojas.map((hoja, indice) => ({ ...hoja, indice }));
}

export function promptFacturaParaHoja(promptBase: string, hoja: HojaFacturaVision, totalHojas: number): string {
  return `${promptBase}

CONTEXTO FACTURA MULTIHOJA:
- Estas leyendo solo la hoja ${hoja.indice + 1} de ${totalHojas} de una misma factura.
- Extrae solamente los datos visibles en esta hoja. No inventes items ni totales de otras hojas.
- Si esta hoja no muestra subtotal, impuestos, total, CAE o condicion de pago, devolve null en esos campos.
- Si una cabecera/emisor/receptor no se ve en esta hoja, devolve null en esos campos; el sistema los combinara con otras hojas.
- Mantene los items en el orden visual de esta hoja.`;
}

export function resumenHojasFactura(hojas: HojaFacturaVision[]): Array<{
  indice: number;
  archivoIndice: number;
  archivoNombre: string;
  pagina: number | null;
  paginasArchivo: number | null;
  label: string;
}> {
  return hojas.map((h) => ({
    indice: h.indice,
    archivoIndice: h.archivoIndice,
    archivoNombre: h.archivoNombre,
    pagina: h.pagina,
    paginasArchivo: h.paginasArchivo,
    label: h.label,
  }));
}

export function validacionFacturaMejora(
  actual: ReturnType<typeof validarTotalesFactura>,
  candidato: ReturnType<typeof validarTotalesFactura>,
): boolean {
  if (candidato.items_cuadran && !actual.items_cuadran) return true;
  if (candidato.items_cuadran && actual.items_cuadran) {
    return candidato.advertencias.length < actual.advertencias.length;
  }

  const actualDiff = actual.diferencia_items == null
    ? Number.POSITIVE_INFINITY
    : Math.abs(actual.diferencia_items);
  const candidatoDiff = candidato.diferencia_items == null
    ? Number.POSITIVE_INFINITY
    : Math.abs(candidato.diferencia_items);

  return candidatoDiff < actualDiff;
}
