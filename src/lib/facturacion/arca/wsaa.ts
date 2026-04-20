import forge from 'node-forge';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

import { desencriptarCampo } from './crypto';
import { getEndpoints } from './endpoints';
import { logArcaOperacion } from './logger';
import { buildLoginCmsRequest } from './xml-builder';

export interface TicketAcceso {
  token: string;
  sign: string;
  expiracion: Date;
}

export async function obtenerTicketAcceso(
  certificadoPem: string,
  clavePrivadaPem: string,
  ambiente: 'homologacion' | 'produccion',
): Promise<TicketAcceso> {
  const endpoints = getEndpoints(ambiente);

  const ahora = new Date();
  const expiracion = new Date(ahora.getTime() + 12 * 60 * 60 * 1000);

  const tra = buildTRA(ahora, expiracion);
  const cmsBase64 = firmarCMS(tra, certificadoPem, clavePrivadaPem);

  const soapBody = buildLoginCmsRequest(cmsBase64);

  const response = await fetch(endpoints.wsaa, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: '',
    },
    body: soapBody,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`WSAA HTTP ${response.status}: ${text.substring(0, 500)}`);
  }

  const responseXml = await response.text();
  const payloadXml = extraerLoginTicketResponse(responseXml);

  const tokenMatch = payloadXml.match(/<token>([\s\S]*?)<\/token>/);
  const signMatch = payloadXml.match(/<sign>([\s\S]*?)<\/sign>/);
  const expMatch = payloadXml.match(/<expirationTime>([\s\S]*?)<\/expirationTime>/);

  if (!tokenMatch || !signMatch) {
    const faultMatch = responseXml.match(/<faultstring>([\s\S]*?)<\/faultstring>/);
    throw new Error(`WSAA error: ${faultMatch?.[1] ?? 'Respuesta inválida'}`);
  }

  return {
    token: tokenMatch[1].trim(),
    sign: signMatch[1].trim(),
    expiracion: expMatch ? new Date(expMatch[1].trim()) : expiracion,
  };
}

function buildTRA(generacion: Date, expiracion: Date): string {
  const uniqueId = Math.floor(generacion.getTime() / 1000);
  const genStr = formatDateARCA(generacion);
  const expStr = formatDateARCA(expiracion);

  return `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${uniqueId}</uniqueId>
    <generationTime>${genStr}</generationTime>
    <expirationTime>${expStr}</expirationTime>
  </header>
  <service>wsfe</service>
</loginTicketRequest>`;
}

function formatDateARCA(date: Date): string {
  const arcaOffsetMinutes = -3 * 60;
  const shiftedDate = new Date(date.getTime() + arcaOffsetMinutes * 60 * 1000);
  const iso = shiftedDate.toISOString().replace('Z', '');
  return `${iso.substring(0, 19)}-03:00`;
}

function extraerLoginTicketResponse(responseXml: string): string {
  const loginCmsReturnMatch = responseXml.match(/<loginCmsReturn>([\s\S]*?)<\/loginCmsReturn>/);

  if (!loginCmsReturnMatch) {
    return responseXml;
  }

  return decodeXmlEntities(loginCmsReturnMatch[1]);
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function firmarCMS(
  contenido: string,
  certificadoPem: string,
  clavePrivadaPem: string,
): string {
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(contenido, 'utf8');

  const cert = forge.pki.certificateFromPem(certificadoPem);
  p7.addCertificate(cert);

  p7.addSigner({
    key: forge.pki.privateKeyFromPem(clavePrivadaPem),
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime },
    ],
  });

  p7.sign({ detached: false });

  const asn1 = p7.toAsn1();
  const der = forge.asn1.toDer(asn1);
  return Buffer.from(der.getBytes(), 'binary').toString('base64');
}

export async function asegurarTicketVigente(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<{ token: string; sign: string }> {
  const { data: config } = await supabase
    .from('arca_config')
    .select('*')
    .eq('tenant_id', tenantId)
    .single();

  if (!config) throw new Error('Configuración ARCA no encontrada');

  const ahora = new Date();
  const expiracion = config.ticket_expiracion ? new Date(config.ticket_expiracion) : null;
  const margen = 5 * 60 * 1000;

  if (config.ticket_acceso && expiracion && expiracion.getTime() - ahora.getTime() > margen) {
    return { token: config.ticket_acceso, sign: config.ticket_sign! };
  }

  if (!config.certificado_pem || !config.clave_privada_pem) {
    throw new Error('Certificado o clave privada no configurados');
  }

  const certPem = desencriptarCampo(config.certificado_pem);
  const keyPem = desencriptarCampo(config.clave_privada_pem);

  let ticket: TicketAcceso;
  try {
    ticket = await obtenerTicketAcceso(certPem, keyPem, config.ambiente);
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    await logArcaOperacion(supabase, tenantId, {
      servicio: 'WSAA',
      operacion: 'LoginCms',
      requestXml: '[TRA firmado]',
      responseXml: '',
      exitoso: false,
      errorCodigo: 'WSAA_RENEW_FAIL',
      errorMensaje: mensaje,
    });
    throw new Error(`Error al renovar ticket WSAA: ${mensaje}`);
  }

  await supabase
    .from('arca_config')
    .update({
      ticket_acceso: ticket.token,
      ticket_sign: ticket.sign,
      ticket_expiracion: ticket.expiracion.toISOString(),
    })
    .eq('tenant_id', tenantId);

  await logArcaOperacion(supabase, tenantId, {
    servicio: 'WSAA',
    operacion: 'LoginCms',
    requestXml: '[TRA firmado]',
    responseXml: '[ticket renovado]',
    exitoso: true,
  });

  return { token: ticket.token, sign: ticket.sign };
}
