import { Buffer } from 'node:buffer';

import { mapTipoComprobante, mapTipoDocReceptor } from '@/lib/facturacion/arca/tipos';

/** Verificador de comprobantes AFIP (mismo esquema que pyafipws `PyQR.URL`). */
export const AFIP_QR_VERIFICADOR_BASE = 'https://www.afip.gob.ar/fe/qr/?p=';

export interface BuildQrArcaUrlParams {
  /** CUIT del emisor (con o sin guiones). */
  cuitEmisor: string;
  puntoVenta: number;
  /** Tipo Nexus (`factura_c`, `nota_credito_b`, …). */
  tipoComprobante: string;
  numero: number;
  importeTotal: number;
  /** Fecha de emisión del comprobante `YYYY-MM-DD`. */
  fechaYmd: string;
  /** CAE de 14 dígitos. */
  cae: string;
  clienteCuitDni: string | null;
  clienteDocumentoFiscalTipo?: 'cuit' | 'dni' | null;
}

/**
 * Arma la URL del QR de constatación AFIP: JSON según especificación, UTF-8 → base64, prefijo oficial.
 * Sin I/O; pensada para tests y para la respuesta de emisión.
 */
export function buildQrArcaUrl(params: BuildQrArcaUrlParams): string {
  const cuitDigits = params.cuitEmisor.replace(/\D/g, '');
  if (cuitDigits.length !== 11) {
    throw new Error('CUIT emisor inválido para QR AFIP');
  }
  const cuit = parseInt(cuitDigits, 10);
  if (!Number.isFinite(cuit)) {
    throw new Error('CUIT emisor inválido para QR AFIP');
  }

  const caeTrim = params.cae.trim();
  if (!/^\d{14}$/.test(caeTrim)) {
    throw new Error('CAE inválido para QR AFIP');
  }
  const codAut = parseInt(caeTrim, 10);
  if (!Number.isFinite(codAut)) {
    throw new Error('CAE inválido para QR AFIP');
  }

  const tipoCmp = mapTipoComprobante(params.tipoComprobante);
  const doc = mapTipoDocReceptor(
    params.clienteCuitDni,
    params.clienteDocumentoFiscalTipo ?? null,
  );
  const nroDocRec = parseInt(doc.nro, 10);
  if (!Number.isFinite(nroDocRec)) {
    throw new Error('Documento receptor inválido para QR AFIP');
  }

  const importe = Math.round(params.importeTotal * 100) / 100;

  const payload = {
    ver: 1,
    fecha: params.fechaYmd,
    cuit,
    ptoVta: params.puntoVenta,
    tipoCmp,
    nroCmp: params.numero,
    importe,
    moneda: 'PES',
    ctz: 1,
    tipoDocRec: doc.tipo,
    nroDocRec,
    tipoCodAut: 'E',
    codAut,
  };

  const json = JSON.stringify(payload);
  const base64 = Buffer.from(json, 'utf8').toString('base64');
  return AFIP_QR_VERIFICADOR_BASE + base64;
}
