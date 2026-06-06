import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as forge from 'node-forge';
import { Repository } from 'typeorm';

import { TenantContext } from '../../auth/tenant-context.service';
import { SucursalContext } from '../../branches/sucursal-context.service';
import { ArcaCryptoService } from '../crypto/arca-crypto.service';
import { ArcaConfig } from '../entities/arca-config.entity';
import { ArcaLog } from '../entities/arca-log.entity';
import { getWsaaEndpoint } from '../wsfe/arca-wsfe-endpoints';

type EnsureOptions = { forceRenew?: boolean };

@Injectable()
export class ArcaWsaaService {
  constructor(
    @InjectRepository(ArcaConfig)
    private readonly arcaConfigRepo: Repository<ArcaConfig>,
    @InjectRepository(ArcaLog)
    private readonly arcaLogRepo: Repository<ArcaLog>,
    private readonly tenantContext: TenantContext,
    private readonly sucursalContext: SucursalContext,
    private readonly crypto: ArcaCryptoService,
  ) {}

  async ensureTicket(options: EnsureOptions = {}) {
    const tenantId = this.tenantContext.getTenantId();
    const sucursalId = await this.sucursalContext.requireSucursalId();
    return this.ensureTicketForTenant(tenantId, sucursalId, options);
  }

  /** Para worker/colas: sucursal expl├¡cita desde comprobante. */
  async ensureTicketForTenant(
    tenantId: string,
    sucursalId: string,
    options: EnsureOptions = {},
  ) {
    const config = await this.arcaConfigRepo.findOne({ where: { tenantId, sucursalId } });
    if (!config) throw new NotFoundException('Configuraci├│n ARCA no encontrada');

    const now = Date.now();
    const marginMs = 5 * 60 * 1000;
    const expirationMs = config.ticketExpiracion ? new Date(config.ticketExpiracion).getTime() : 0;
    const validCached =
      !options.forceRenew &&
      Boolean(config.ticketAcceso) &&
      Boolean(config.ticketSign) &&
      expirationMs - now > marginMs;

    if (validCached) {
      return {
        data: {
          source: 'cache',
          token: config.ticketAcceso,
          sign: config.ticketSign,
          expiracion: config.ticketExpiracion?.toISOString() ?? null,
          ambiente: config.ambiente,
        },
      };
    }

    if (!config.certificadoPem || !config.clavePrivadaPem) {
      throw new BadRequestException('Faltan certificado y/o clave privada para WSAA');
    }

    const certPem = this.crypto.decrypt(config.certificadoPem);
    const keyPem = this.crypto.decrypt(config.clavePrivadaPem);
    const tra = buildTRA(new Date());
    const cmsBase64 = signTRAAsCmsBase64(tra, certPem, keyPem);
    const soapBody = buildLoginCmsRequest(cmsBase64);
    const endpoint = getWsaaEndpoint(config.ambiente);

    let responseText = '';
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: '',
        },
        body: soapBody,
      });
      responseText = await response.text();
      if (!response.ok) {
        await this.logWsaa({
          tenantId,
          requestXml: soapBody,
          responseXml: responseText,
          exitoso: false,
          errorCodigo: String(response.status),
          errorMensaje: `WSAA HTTP ${response.status}`,
        });
        throw new ServiceUnavailableException(`WSAA HTTP ${response.status}`);
      }

      const parsed = parseWsaaResponse(responseText);
      if (!parsed.ok) {
        await this.logWsaa({
          tenantId,
          requestXml: soapBody,
          responseXml: responseText,
          exitoso: false,
          errorCodigo: parsed.errorCode ?? null,
          errorMensaje: parsed.errorMessage,
        });
        throw new ServiceUnavailableException(`WSAA error: ${parsed.errorMessage}`);
      }

      config.ticketAcceso = parsed.token;
      config.ticketSign = parsed.sign;
      config.ticketExpiracion = parsed.expiracion;
      await this.arcaConfigRepo.save(config);

      await this.logWsaa({
        tenantId,
        requestXml: soapBody,
        responseXml: responseText,
        exitoso: true,
        errorCodigo: null,
        errorMensaje: null,
      });

      return {
        data: {
          source: 'refresh',
          token: parsed.token,
          sign: parsed.sign,
          expiracion: parsed.expiracion.toISOString(),
          ambiente: config.ambiente,
        },
      };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      await this.logWsaa({
        tenantId,
        requestXml: soapBody,
        responseXml: responseText || null,
        exitoso: false,
        errorCodigo: 'NETWORK',
        errorMensaje: error instanceof Error ? error.message : 'Error desconocido',
      });
      throw new ServiceUnavailableException(
        `No se pudo obtener ticket WSAA: ${error instanceof Error ? error.message : 'error desconocido'}`,
      );
    }
  }

  private async logWsaa(params: {
    tenantId: string;
    requestXml: string | null;
    responseXml: string | null;
    exitoso: boolean;
    errorCodigo: string | null;
    errorMensaje: string | null;
  }): Promise<void> {
    const log = this.arcaLogRepo.create({
      tenantId: params.tenantId,
      servicio: 'WSAA',
      operacion: 'LoginCms',
      requestXml: params.requestXml,
      responseXml: params.responseXml,
      exitoso: params.exitoso,
      errorCodigo: params.errorCodigo,
      errorMensaje: params.errorMensaje,
      comprobanteId: null,
    });
    await this.arcaLogRepo.save(log);
  }
}

function buildTRA(now: Date): string {
  const generation = new Date(now.getTime() - 60_000);
  const expiration = new Date(now.getTime() + 12 * 60 * 60 * 1000);
  const uniqueId = Math.floor(generation.getTime() / 1000);
  return `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${uniqueId}</uniqueId>
    <generationTime>${formatArcaDate(generation)}</generationTime>
    <expirationTime>${formatArcaDate(expiration)}</expirationTime>
  </header>
  <service>wsfe</service>
</loginTicketRequest>`;
}

function formatArcaDate(date: Date): string {
  const offsetMs = 3 * 60 * 60 * 1000;
  const argentinaLike = new Date(date.getTime() - offsetMs);
  const base = argentinaLike.toISOString().slice(0, 19);
  return `${base}-03:00`;
}

function signTRAAsCmsBase64(traXml: string, certPem: string, privateKeyPem: string): string {
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(traXml, 'utf8');
  const cert = forge.pki.certificateFromPem(certPem);
  const key = forge.pki.privateKeyFromPem(privateKeyPem);
  p7.addCertificate(cert);
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime },
    ],
  });
  p7.sign({ detached: false });
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return Buffer.from(der, 'binary').toString('base64');
}

function buildLoginCmsRequest(cmsBase64: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">
  <soapenv:Header/>
  <soapenv:Body>
    <wsaa:loginCms>
      <wsaa:in0>${cmsBase64}</wsaa:in0>
    </wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>`;
}

function parseWsaaResponse(xml: string):
  | { ok: true; token: string; sign: string; expiracion: Date }
  | { ok: false; errorCode?: string; errorMessage: string } {
  const token = xml.match(/<token>([\s\S]*?)<\/token>/i)?.[1]?.trim();
  const sign = xml.match(/<sign>([\s\S]*?)<\/sign>/i)?.[1]?.trim();
  const expirationText = xml.match(/<expirationTime>([\s\S]*?)<\/expirationTime>/i)?.[1]?.trim();

  if (!token || !sign) {
    const fault = xml.match(/<faultstring>([\s\S]*?)<\/faultstring>/i)?.[1]?.trim();
    const code = xml.match(/<faultcode>([\s\S]*?)<\/faultcode>/i)?.[1]?.trim();
    return {
      ok: false,
      errorCode: code,
      errorMessage: fault ?? 'Respuesta WSAA inv├ílida',
    };
  }

  return {
    ok: true,
    token,
    sign,
    expiracion: expirationText ? new Date(expirationText) : new Date(Date.now() + 12 * 60 * 60 * 1000),
  };
}
