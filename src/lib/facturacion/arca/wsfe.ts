import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

import { fetchWsfePost } from './fetch-wsfe-retry';
import { formatFetchError } from './format-fetch-error';
import { getEndpoints } from './endpoints';
import { logArcaOperacion } from './logger';
import { CONCEPTO, mapTipoComprobante, mapTipoDocReceptor } from './tipos';
import { asegurarTicketVigente } from './wsaa';
import {
  buildFECAESolicitar,
  buildFECompUltimoAutorizado,
  type TributoAFIP,
} from './xml-builder';

export interface SolicitudCAE {
  tenantId: string;
  tipo: string;
  numero: number;
  fecha: string;
  clienteCuitDni: string | null;
  importeTotal: number;
  importeNeto: number;
  importeIVA: number;
  alicuotaIVA: number;
  impTrib?: number;
  tributos?: TributoAFIP[];
}

export interface ResultadoCAE {
  aprobado: boolean;
  cae: string | null;
  caeVencimiento: string | null;
  errores: { codigo: string; mensaje: string }[];
  observaciones: { codigo: string; mensaje: string }[];
}

export async function solicitarCAE(
  supabase: SupabaseClient<Database>,
  config: {
    tenant_id: string;
    cuit_emisor: string;
    punto_de_venta: number;
    ambiente: 'homologacion' | 'produccion';
  },
  solicitud: SolicitudCAE,
  comprobanteId?: string,
): Promise<ResultadoCAE> {
  const endpoints = getEndpoints(config.ambiente);

  const { token, sign } = await asegurarTicketVigente(supabase, config.tenant_id);

  const tipoComprobante = mapTipoComprobante(solicitud.tipo);
  const docReceptor = mapTipoDocReceptor(solicitud.clienteCuitDni);
  const fechaFormateada = solicitud.fecha.replace(/-/g, '');

  const soapBody = buildFECAESolicitar({
    token,
    sign,
    cuit: config.cuit_emisor,
    puntoDeVenta: config.punto_de_venta,
    tipoComprobante,
    concepto: CONCEPTO.PRODUCTOS,
    numeroDesde: solicitud.numero,
    numeroHasta: solicitud.numero,
    fechaComprobante: fechaFormateada,
    tipoDocReceptor: docReceptor.tipo,
    nroDocReceptor: docReceptor.nro,
    importeTotal: solicitud.importeTotal,
    importeNeto: solicitud.importeNeto,
    importeIVA: solicitud.importeIVA,
    importeExento: 0,
    alicuotaIVA: solicitud.alicuotaIVA,
    impTrib: solicitud.impTrib,
    tributos: solicitud.tributos,
  });

  let responseXml: string;
  try {
    const response = await fetchWsfePost(endpoints.wsfe, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: 'http://ar.gov.afip.dif.FEV1/FECAESolicitar',
      },
      body: soapBody,
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(`WSFE HTTP ${response.status}`);
    }

    responseXml = await response.text();
  } catch (err) {
    const mensaje = formatFetchError(err);

    await logArcaOperacion(supabase, config.tenant_id, {
      servicio: 'WSFE',
      operacion: 'FECAESolicitar',
      requestXml: soapBody,
      responseXml: '',
      comprobanteId,
      exitoso: false,
      errorCodigo: 'NETWORK',
      errorMensaje: mensaje,
    });

    return {
      aprobado: false,
      cae: null,
      caeVencimiento: null,
      errores: [{ codigo: 'NETWORK', mensaje }],
      observaciones: [],
    };
  }

  const resultado = parsearRespuestaCAE(responseXml);

  await logArcaOperacion(supabase, config.tenant_id, {
    servicio: 'WSFE',
    operacion: 'FECAESolicitar',
    requestXml: soapBody,
    responseXml,
    comprobanteId,
    exitoso: resultado.aprobado,
    errorCodigo: resultado.errores[0]?.codigo ?? resultado.observaciones[0]?.codigo,
    errorMensaje: resultado.errores[0]?.mensaje ?? resultado.observaciones[0]?.mensaje,
  });

  return resultado;
}

function parsearRespuestaCAE(xml: string): ResultadoCAE {
  const resultado = xml.match(/<Resultado>(.*?)<\/Resultado>/)?.[1];
  const cae = xml.match(/<CAE>(.*?)<\/CAE>/)?.[1] || null;
  const caeVto = xml.match(/<CAEFchVto>(.*?)<\/CAEFchVto>/)?.[1] || null;

  const errores: { codigo: string; mensaje: string }[] = [];
  const errorMatches = xml.matchAll(
    /<Err>[\s\S]*?<Code>(.*?)<\/Code>[\s\S]*?<Msg>(.*?)<\/Msg>[\s\S]*?<\/Err>/g,
  );
  for (const match of errorMatches) {
    errores.push({ codigo: match[1], mensaje: match[2] });
  }

  const observaciones: { codigo: string; mensaje: string }[] = [];
  const obsMatches = xml.matchAll(
    /<Obs>[\s\S]*?<Code>(.*?)<\/Code>[\s\S]*?<Msg>(.*?)<\/Msg>[\s\S]*?<\/Obs>/g,
  );
  for (const match of obsMatches) {
    observaciones.push({ codigo: match[1], mensaje: match[2] });
  }

  const caeVencimiento = caeVto
    ? `${caeVto.substring(0, 4)}-${caeVto.substring(4, 6)}-${caeVto.substring(6, 8)}`
    : null;

  return {
    aprobado: resultado === 'A' && !!cae,
    cae,
    caeVencimiento,
    errores,
    observaciones,
  };
}

export async function consultarUltimoComprobante(
  supabase: SupabaseClient<Database>,
  config: {
    tenant_id: string;
    cuit_emisor: string;
    punto_de_venta: number;
    ambiente: 'homologacion' | 'produccion';
  },
  tipoComprobante: string,
): Promise<number> {
  const endpoints = getEndpoints(config.ambiente);
  const { token, sign } = await asegurarTicketVigente(supabase, config.tenant_id);
  const tipoCodigo = mapTipoComprobante(tipoComprobante);

  const soapBody = buildFECompUltimoAutorizado(
    token,
    sign,
    config.cuit_emisor,
    config.punto_de_venta,
    tipoCodigo,
  );

  let response: Response;
  try {
    response = await fetchWsfePost(endpoints.wsfe, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: 'http://ar.gov.afip.dif.FEV1/FECompUltimoAutorizado',
      },
      body: soapBody,
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    throw new Error(
      `Red hacia WSFE (${endpoints.wsfe}): ${formatFetchError(err)}`,
    );
  }

  const xml = await response.text();

  if (!response.ok) {
    throw new Error(
      `WSFE HTTP ${response.status} ${response.statusText} (${endpoints.wsfe}): ${xml.substring(0, 400)}`,
    );
  }

  await logArcaOperacion(supabase, config.tenant_id, {
    servicio: 'WSFE',
    operacion: 'FECompUltimoAutorizado',
    requestXml: soapBody,
    responseXml: xml,
    exitoso: response.ok,
  });

  const nroMatch = xml.match(/<CbteNro>(.*?)<\/CbteNro>/);
  return nroMatch ? parseInt(nroMatch[1]) : 0;
}
