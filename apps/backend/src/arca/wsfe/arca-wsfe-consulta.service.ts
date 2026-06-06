import { Injectable } from '@nestjs/common';

import { TipoComprobante } from '../../facturacion/enums/tipo-comprobante.enum';
import { ArcaConfig } from '../entities/arca-config.entity';
import { ArcaAmbiente } from '../enums/arca-ambiente.enum';
import {
  buildFECompConsultar,
  buildFECompUltimoAutorizado,
  feCompConsultarIndicaComprobanteExistente,
  mapTipoComprobanteWsfe,
  parsearCbteFchFeCompConsultar,
  parsearCbteNroFeCompUltimoAutorizado,
} from '../utils/arca-wsfe-xml.util';
import { ArcaWsaaService } from '../wsaa/arca-wsaa.service';
import { getWsfeEndpoint } from '../wsfe/arca-wsfe-endpoints';

export type WsfeConsultaOptions = {
  timeoutMs?: number;
};

@Injectable()
export class ArcaWsfeConsultaService {
  constructor(private readonly wsaa: ArcaWsaaService) {}

  async consultarUltimoComprobante(
    tenantId: string,
    sucursalId: string,
    config: Pick<ArcaConfig, 'cuitEmisor' | 'puntoDeVenta' | 'ambiente'>,
    tipo: TipoComprobante,
    options?: WsfeConsultaOptions,
  ): Promise<number> {
    const xml = await this.feCompUltimoAutorizadoXml(tenantId, sucursalId, config, tipo, options);
    return parsearCbteNroFeCompUltimoAutorizado(xml);
  }

  async consultarCbteFch(
    tenantId: string,
    sucursalId: string,
    config: Pick<ArcaConfig, 'cuitEmisor' | 'puntoDeVenta' | 'ambiente'>,
    tipo: TipoComprobante,
    cbteNro: number,
    options?: WsfeConsultaOptions,
  ): Promise<string | null> {
    const k = Math.trunc(cbteNro);
    if (!Number.isFinite(cbteNro) || k < 1) return null;
    const xml = await this.feCompConsultarXml(tenantId, sucursalId, config, tipo, k, options);
    return parsearCbteFchFeCompConsultar(xml);
  }

  async consultarComprobanteExisteEnAfip(
    tenantId: string,
    sucursalId: string,
    config: Pick<ArcaConfig, 'cuitEmisor' | 'puntoDeVenta' | 'ambiente'>,
    tipo: TipoComprobante,
    cbteNro: number,
    options?: WsfeConsultaOptions,
  ): Promise<boolean> {
    const xml = await this.feCompConsultarXml(tenantId, sucursalId, config, tipo, cbteNro, options);
    return feCompConsultarIndicaComprobanteExistente(xml);
  }

  private async feCompUltimoAutorizadoXml(
    tenantId: string,
    sucursalId: string,
    config: Pick<ArcaConfig, 'cuitEmisor' | 'puntoDeVenta' | 'ambiente'>,
    tipo: TipoComprobante,
    options?: WsfeConsultaOptions,
  ): Promise<string> {
    if (!config.cuitEmisor || config.puntoDeVenta == null) {
      throw new Error('Configuraci├│n ARCA incompleta');
    }
    const ticket = await this.wsaa.ensureTicketForTenant(tenantId, sucursalId);
    const token = ticket.data.token;
    const sign = ticket.data.sign;
    if (!token || !sign) throw new Error('Ticket WSAA inv├ílido');

    const soapBody = buildFECompUltimoAutorizado(
      token,
      sign,
      config.cuitEmisor,
      config.puntoDeVenta,
      mapTipoComprobanteWsfe(tipo),
    );
    return this.wsfePost(config.ambiente, soapBody, 'FECompUltimoAutorizado', options);
  }

  private async feCompConsultarXml(
    tenantId: string,
    sucursalId: string,
    config: Pick<ArcaConfig, 'cuitEmisor' | 'puntoDeVenta' | 'ambiente'>,
    tipo: TipoComprobante,
    cbteNro: number,
    options?: WsfeConsultaOptions,
  ): Promise<string> {
    if (!config.cuitEmisor || config.puntoDeVenta == null) {
      throw new Error('Configuraci├│n ARCA incompleta');
    }
    const ticket = await this.wsaa.ensureTicketForTenant(tenantId, sucursalId);
    const token = ticket.data.token;
    const sign = ticket.data.sign;
    if (!token || !sign) throw new Error('Ticket WSAA inv├ílido');

    const soapBody = buildFECompConsultar(
      token,
      sign,
      config.cuitEmisor,
      config.puntoDeVenta,
      mapTipoComprobanteWsfe(tipo),
      cbteNro,
    );
    return this.wsfePost(config.ambiente, soapBody, 'FECompConsultar', options);
  }

  private async wsfePost(
    ambiente: ArcaAmbiente,
    soapBody: string,
    operacion: 'FECompUltimoAutorizado' | 'FECompConsultar',
    options?: WsfeConsultaOptions,
  ): Promise<string> {
    const endpoint = getWsfeEndpoint(ambiente);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: `http://ar.gov.afip.dif.FEV1/${operacion}`,
      },
      body: soapBody,
      signal: AbortSignal.timeout(options?.timeoutMs ?? 30_000),
    });
    const xml = await response.text();
    if (!response.ok) {
      throw new Error(`WSFE HTTP ${response.status}`);
    }
    return xml;
  }
}
