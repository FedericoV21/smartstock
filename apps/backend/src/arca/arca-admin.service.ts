import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { SucursalContext } from '../branches/sucursal-context.service';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { EstadoComprobante } from '../facturacion/enums/estado-comprobante.enum';
import { TipoComprobante } from '../facturacion/enums/tipo-comprobante.enum';
import { ArcaService } from './arca.service';
import { ArcaCryptoService } from './crypto/arca-crypto.service';
import { ArcaConfig } from './entities/arca-config.entity';
import { ArcaLog } from './entities/arca-log.entity';
import { verificarVencimientoCertificado } from './utils/arca-cert-check.util';
import {
  buildFECompUltimoAutorizado,
  mapTipoComprobanteWsfe,
  parsearCbteNroFeCompUltimoAutorizado,
} from './utils/arca-wsfe-xml.util';
import { ArcaWsaaService } from './wsaa/arca-wsaa.service';
import { getWsfeEndpoint } from './wsfe/arca-wsfe-endpoints';

const TIPOS_SYNC: TipoComprobante[] = [
  TipoComprobante.factura_a,
  TipoComprobante.factura_b,
  TipoComprobante.factura_c,
];

@Injectable()
export class ArcaAdminService {
  constructor(
    @InjectRepository(ArcaConfig)
    private readonly arcaConfigRepo: Repository<ArcaConfig>,
    @InjectRepository(ArcaLog)
    private readonly arcaLogRepo: Repository<ArcaLog>,
    @InjectRepository(Comprobante)
    private readonly comprobanteRepo: Repository<Comprobante>,
    private readonly arcaService: ArcaService,
    private readonly arcaWsaaService: ArcaWsaaService,
    private readonly tenantContext: TenantContext,
    private readonly sucursalContext: SucursalContext,
    private readonly crypto: ArcaCryptoService,
  ) {}

  async getCertStatus() {
    await this.arcaService.assertFacturadorArcaEnabled();
    const tenantId = this.tenantContext.getTenantId();
    const sucursalId = await this.sucursalContext.requireSucursalId();

    const config = await this.arcaConfigRepo.findOne({
      where: { tenantId, sucursalId },
      select: { certificadoPem: true },
    });

    if (!config?.certificadoPem) {
      return { data: { configurado: false } };
    }

    try {
      const certPem = this.crypto.decrypt(config.certificadoPem);
      const info = verificarVencimientoCertificado(certPem);
      return {
        data: {
          configurado: true,
          valido: info.valido,
          diasRestantes: info.diasRestantes,
          fechaVencimiento: info.fechaVencimiento?.toISOString() ?? null,
          subject: info.subject,
          alerta: info.diasRestantes <= 30,
          critico: info.diasRestantes <= 7,
          expirado: !info.valido,
        },
      };
    } catch {
      return { data: { configurado: true, error: 'Error al verificar certificado' } };
    }
  }

  async testConnection() {
    await this.arcaService.assertFacturadorArcaEnabled();
    const tenantId = this.tenantContext.getTenantId();
    const sucursalId = await this.sucursalContext.requireSucursalId();
    const config = await this.arcaService.findConfigOrThrow(tenantId, sucursalId);

    const resultado: {
      wsaa: { ok: boolean; error?: string };
      wsfe: { ok: boolean; ultimoComprobante?: number; error?: string };
    } = {
      wsaa: { ok: false },
      wsfe: { ok: false },
    };

    if (!config.certificadoPem || !config.clavePrivadaPem) {
      return {
        data: {
          wsaa: { ok: false, error: 'Certificado o clave privada no configurados' },
          wsfe: { ok: false, error: 'No se pudo probar sin ticket WSAA' },
        },
      };
    }

    try {
      await this.arcaWsaaService.ensureTicketForTenant(tenantId, sucursalId, { forceRenew: true });
      await this.logOperacion(tenantId, {
        servicio: 'WSAA',
        operacion: 'TestConnection',
        exitoso: true,
      });
      resultado.wsaa = { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      resultado.wsaa = { ok: false, error: msg };
      await this.logOperacion(tenantId, {
        servicio: 'WSAA',
        operacion: 'TestConnection',
        exitoso: false,
        errorCodigo: 'TEST_WSAA_FAIL',
        errorMensaje: msg,
      });
      return { data: { ...resultado, wsfe: { ok: false, error: 'No se pudo probar WSFE sin ticket WSAA' } } };
    }

    if (!config.cuitEmisor || config.puntoDeVenta == null) {
      resultado.wsfe = { ok: false, error: 'CUIT o punto de venta no configurados' };
      return { data: resultado };
    }

    try {
      const ultimo = await this.consultarUltimoComprobante(
        tenantId,
        sucursalId,
        TipoComprobante.factura_b,
        20_000,
      );
      resultado.wsfe = { ok: true, ultimoComprobante: ultimo };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      resultado.wsfe = { ok: false, error: msg };
    }

    return { data: resultado };
  }

  async syncNumeracion() {
    await this.arcaService.assertFacturadorArcaEnabled();
    const tenantId = this.tenantContext.getTenantId();
    const sucursalId = await this.sucursalContext.requireSucursalId();
    const config = await this.arcaService.findConfigOrThrow(tenantId, sucursalId);

    if (!config.cuitEmisor || config.puntoDeVenta == null) {
      throw new BadRequestException('Configuraci├│n ARCA incompleta');
    }

    const resultados: Record<
      string,
      { arca: number; local: number; discrepancia: boolean }
    > = {};

    for (const tipo of TIPOS_SYNC) {
      try {
        const ultimoArca = await this.consultarUltimoComprobante(tenantId, sucursalId, tipo);

        const ultimoLocal = await this.comprobanteRepo
          .createQueryBuilder('c')
          .select('c.numero', 'numero')
          .where('c.tenant_id = :tenantId', { tenantId })
          .andWhere('c.sucursal_id = :sucursalId', { sucursalId })
          .andWhere('c.tipo = :tipo', { tipo })
          .andWhere('c.estado != :errorArca', { errorArca: EstadoComprobante.error_arca })
          .orderBy('c.numero', 'DESC')
          .limit(1)
          .getRawOne<{ numero: number | null }>();

        const localNum = ultimoLocal?.numero ?? 0;
        resultados[tipo] = {
          arca: ultimoArca,
          local: localNum,
          discrepancia: ultimoArca !== localNum,
        };
      } catch {
        resultados[tipo] = { arca: -1, local: -1, discrepancia: true };
      }
    }

    const ultimoGeneral = Math.max(
      ...Object.values(resultados)
        .map((r) => r.arca)
        .filter((n) => n >= 0),
      0,
    );

    await this.arcaConfigRepo.update(
      { tenantId, sucursalId },
      { ultimoComprobante: ultimoGeneral > 0 ? ultimoGeneral : null },
    );

    return { data: { resultados } };
  }

  private async consultarUltimoComprobante(
    tenantId: string,
    sucursalId: string,
    tipo: TipoComprobante,
    timeoutMs = 30_000,
  ): Promise<number> {
    const config = await this.arcaService.findConfigOrThrow(tenantId, sucursalId);
    const ticket = await this.arcaWsaaService.ensureTicketForTenant(tenantId, sucursalId);
    const token = ticket.data.token;
    const sign = ticket.data.sign;
    if (!token || !sign || !config.cuitEmisor || config.puntoDeVenta == null) {
      throw new Error('Configuraci├│n o ticket WSAA incompletos');
    }

    const tipoCodigo = mapTipoComprobanteWsfe(tipo);
    const soapBody = buildFECompUltimoAutorizado(
      token,
      sign,
      config.cuitEmisor,
      config.puntoDeVenta,
      tipoCodigo,
    );
    const endpoint = getWsfeEndpoint(config.ambiente);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: 'http://ar.gov.afip.dif.FEV1/FECompUltimoAutorizado',
      },
      body: soapBody,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const xml = await response.text();

    await this.logOperacion(tenantId, {
      servicio: 'WSFE',
      operacion: 'FECompUltimoAutorizado',
      requestXml: soapBody,
      responseXml: xml,
      exitoso: response.ok,
    });

    if (!response.ok) {
      throw new Error(`WSFE HTTP ${response.status}`);
    }

    return parsearCbteNroFeCompUltimoAutorizado(xml);
  }

  private async logOperacion(
    tenantId: string,
    params: {
      servicio: string;
      operacion: string;
      requestXml?: string;
      responseXml?: string;
      exitoso: boolean;
      errorCodigo?: string;
      errorMensaje?: string;
    },
  ) {
    const row = this.arcaLogRepo.create({
      tenantId,
      servicio: params.servicio,
      operacion: params.operacion,
      requestXml: params.requestXml ?? '[test connection]',
      responseXml: params.responseXml ?? (params.exitoso ? '[ok]' : ''),
      exitoso: params.exitoso,
      errorCodigo: params.errorCodigo ?? null,
      errorMensaje: params.errorMensaje ?? null,
      comprobanteId: null,
    });
    await this.arcaLogRepo.save(row);
  }
}
