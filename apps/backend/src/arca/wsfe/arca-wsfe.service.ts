import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TenantContext } from '../../auth/tenant-context.service';
import { Comprobante } from '../../facturacion/entities/comprobante.entity';
import { TipoComprobante } from '../../facturacion/enums/tipo-comprobante.enum';
import { SolicitarCaeDto } from '../dto/solicitar-cae.dto';
import { ArcaLog } from '../entities/arca-log.entity';
import { ArcaConfig } from '../entities/arca-config.entity';
import { ArcaWsaaService } from '../wsaa/arca-wsaa.service';
import { getWsfeEndpoint } from './arca-wsfe-endpoints';
import { ArcaSolicitarCaeOrchestratorService } from './arca-solicitar-cae-orchestrator.service';

type ResultadoCae = {
  estado: 'aprobado' | 'rechazado' | 'pendiente';
  cae: string | null;
  caeVencimiento: string | null;
  errores: Array<{ codigo: string; mensaje: string }>;
  observaciones: Array<{ codigo: string; mensaje: string }>;
};

@Injectable()
export class ArcaWsfeService {
  constructor(
    @InjectRepository(ArcaLog)
    private readonly arcaLogRepo: Repository<ArcaLog>,
    @InjectRepository(Comprobante)
    private readonly comprobanteRepo: Repository<Comprobante>,
    private readonly tenantContext: TenantContext,
    private readonly arcaWsaaService: ArcaWsaaService,
    @Inject(forwardRef(() => ArcaSolicitarCaeOrchestratorService))
    private readonly orchestrator: ArcaSolicitarCaeOrchestratorService,
  ) {}

  async solicitarCae(dto: SolicitarCaeDto) {
    return this.solicitarCaeForTenant(this.tenantContext.getTenantId(), dto);
  }

  /** SOAP FECAESolicitar sin persistir comprobante (orquestador v9). */
  async ejecutarFecaeSolicitar(params: {
    tenantId: string;
    sucursalId: string;
    comprobanteId: string;
    config: ArcaConfig;
    comprobante: Pick<
      Comprobante,
      'tipo' | 'subtotal' | 'ivaMonto' | 'ivaPorcentaje' | 'total' | 'financiacionMonto'
    >;
    numero: number;
    fechaYmd: string;
    clienteDocumento?: string | null;
    alicuotaIva?: number;
  }): Promise<ResultadoCae & { requestXml: string; responseXml: string | null }> {
    const doc = mapDocumentoReceptor(params.clienteDocumento);
    const ticket = await this.arcaWsaaService.ensureTicketForTenant(
      params.tenantId,
      params.sucursalId,
    );
    const token = ticket.data.token;
    const sign = ticket.data.sign;
    if (!token || !sign) {
      throw new ServiceUnavailableException('No se obtuvo ticket WSAA v├ílido para WSFE');
    }
    if (!params.config.cuitEmisor || params.config.puntoDeVenta == null) {
      throw new BadRequestException('Configuraci├│n ARCA incompleta');
    }

    const alicuotaIva = params.alicuotaIva ?? Number(params.comprobante.ivaPorcentaje);
    const impTrib =
      Number(params.comprobante.financiacionMonto ?? 0) > 0.001
        ? Number(params.comprobante.financiacionMonto)
        : 0;
    const soapBody = buildFECAESolicitar({
      token,
      sign,
      cuit: params.config.cuitEmisor,
      puntoDeVenta: params.config.puntoDeVenta,
      tipoComprobante: mapTipoComprobante(params.comprobante.tipo),
      numeroComprobante: params.numero,
      fechaComprobante: params.fechaYmd.replace(/-/g, ''),
      tipoDocReceptor: doc.tipo,
      nroDocReceptor: doc.nro,
      importeTotal: Number(params.comprobante.total),
      importeNeto: Number(params.comprobante.subtotal),
      importeIVA: Number(params.comprobante.ivaMonto),
      impTrib,
      alicuotaIVA: alicuotaIva,
    });
    const endpoint = getWsfeEndpoint(params.config.ambiente);

    let responseXml = '';
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: 'http://ar.gov.afip.dif.FEV1/FECAESolicitar',
        },
        body: soapBody,
        signal: AbortSignal.timeout(30_000),
      });
      responseXml = await response.text();
      if (!response.ok) {
        throw new Error(`WSFE HTTP ${response.status}`);
      }
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : 'Error de red desconocido';
      await this.logWsfe({
        tenantId: params.tenantId,
        comprobanteId: params.comprobanteId,
        requestXml: soapBody,
        responseXml: responseXml || null,
        exitoso: false,
        errorCodigo: 'NETWORK',
        errorMensaje: mensaje,
      });
      return {
        estado: 'pendiente',
        cae: null,
        caeVencimiento: null,
        errores: [{ codigo: 'NETWORK', mensaje }],
        observaciones: [],
        requestXml: soapBody,
        responseXml: responseXml || null,
      };
    }

    const parsed = parseWsfeResponse(responseXml);
    await this.logWsfe({
      tenantId: params.tenantId,
      comprobanteId: params.comprobanteId,
      requestXml: soapBody,
      responseXml,
      exitoso: parsed.aprobado,
      errorCodigo: parsed.errores[0]?.codigo ?? null,
      errorMensaje: parsed.errores[0]?.mensaje ?? null,
    });

    return {
      estado: parsed.aprobado ? 'aprobado' : 'rechazado',
      cae: parsed.cae,
      caeVencimiento: parsed.caeVencimiento,
      errores: parsed.errores,
      observaciones: parsed.observaciones,
      requestXml: soapBody,
      responseXml,
    };
  }

  /** Colas/worker: delega al orquestador v9 (numeraci├│n AFIP + FECAE). */
  async solicitarCaeForTenant(tenantId: string, dto: SolicitarCaeDto) {
    const comprobante = await this.comprobanteRepo.findOne({
      where: { id: dto.comprobanteId, tenantId },
    });
    if (!comprobante) {
      throw new NotFoundException('Comprobante no encontrado');
    }
    return this.orchestrator.solicitarCaeForTenantApi(tenantId, {
      comprobanteId: dto.comprobanteId,
      clienteDocumento: dto.clienteDocumento,
      alicuotaIva: dto.alicuotaIva,
      fechaComprobante: comprobante.fecha,
    });
  }

  private async logWsfe(params: {
    tenantId: string;
    comprobanteId: string;
    requestXml: string | null;
    responseXml: string | null;
    exitoso: boolean;
    errorCodigo: string | null;
    errorMensaje: string | null;
  }) {
    const row = this.arcaLogRepo.create({
      tenantId: params.tenantId,
      servicio: 'WSFE',
      operacion: 'FECAESolicitar',
      requestXml: params.requestXml,
      responseXml: params.responseXml,
      exitoso: params.exitoso,
      errorCodigo: params.errorCodigo,
      errorMensaje: params.errorMensaje,
      comprobanteId: params.comprobanteId,
    });
    await this.arcaLogRepo.save(row);
  }
}

function mapTipoComprobante(tipo: TipoComprobante): number {
  const map: Record<TipoComprobante, number | null> = {
    [TipoComprobante.factura_a]: 1,
    [TipoComprobante.factura_b]: 6,
    [TipoComprobante.factura_c]: 11,
    [TipoComprobante.nota_credito_a]: 3,
    [TipoComprobante.nota_credito_b]: 8,
    [TipoComprobante.nota_credito_c]: 13,
    [TipoComprobante.remito]: null,
    [TipoComprobante.presupuesto]: null,
    [TipoComprobante.ticket]: null,
    [TipoComprobante.recibo]: null,
  };
  const code = map[tipo];
  if (!code) {
    throw new BadRequestException(`Tipo de comprobante no soportado por WSFE: ${tipo}`);
  }
  return code;
}

function mapDocumentoReceptor(documento?: string | null): { tipo: number; nro: string } {
  if (!documento) return { tipo: 99, nro: '0' };
  const limpio = documento.replace(/[-\s]/g, '');
  if (/^\d{11}$/.test(limpio)) return { tipo: 80, nro: limpio };
  if (/^\d{7,8}$/.test(limpio)) return { tipo: 96, nro: limpio };
  return { tipo: 99, nro: '0' };
}

function buildFECAESolicitar(params: {
  token: string;
  sign: string;
  cuit: string;
  puntoDeVenta: number;
  tipoComprobante: number;
  numeroComprobante: number;
  fechaComprobante: string;
  tipoDocReceptor: number;
  nroDocReceptor: string;
  importeTotal: number;
  importeNeto: number;
  importeIVA: number;
  impTrib: number;
  alicuotaIVA: number;
}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soapenv:Body>
    <ar:FECAESolicitar>
      <ar:Auth>
        <ar:Token>${params.token}</ar:Token>
        <ar:Sign>${params.sign}</ar:Sign>
        <ar:Cuit>${params.cuit}</ar:Cuit>
      </ar:Auth>
      <ar:FeCAEReq>
        <ar:FeCabReq>
          <ar:CantReg>1</ar:CantReg>
          <ar:PtoVta>${params.puntoDeVenta}</ar:PtoVta>
          <ar:CbteTipo>${params.tipoComprobante}</ar:CbteTipo>
        </ar:FeCabReq>
        <ar:FeDetReq>
          <ar:FECAEDetRequest>
            <ar:Concepto>1</ar:Concepto>
            <ar:DocTipo>${params.tipoDocReceptor}</ar:DocTipo>
            <ar:DocNro>${params.nroDocReceptor}</ar:DocNro>
            <ar:CbteDesde>${params.numeroComprobante}</ar:CbteDesde>
            <ar:CbteHasta>${params.numeroComprobante}</ar:CbteHasta>
            <ar:CbteFch>${params.fechaComprobante}</ar:CbteFch>
            <ar:ImpTotal>${params.importeTotal.toFixed(2)}</ar:ImpTotal>
            <ar:ImpTotConc>0.00</ar:ImpTotConc>
            <ar:ImpNeto>${params.importeNeto.toFixed(2)}</ar:ImpNeto>
            <ar:ImpOpEx>0.00</ar:ImpOpEx>
            <ar:ImpIVA>${params.importeIVA.toFixed(2)}</ar:ImpIVA>
            <ar:ImpTrib>${params.impTrib.toFixed(2)}</ar:ImpTrib>
            <ar:MonId>PES</ar:MonId>
            <ar:MonCotiz>1</ar:MonCotiz>
            <ar:Iva>
              <ar:AlicIva>
                <ar:Id>${mapAlicuotaIvaId(params.alicuotaIVA)}</ar:Id>
                <ar:BaseImp>${params.importeNeto.toFixed(2)}</ar:BaseImp>
                <ar:Importe>${params.importeIVA.toFixed(2)}</ar:Importe>
              </ar:AlicIva>
            </ar:Iva>
          </ar:FECAEDetRequest>
        </ar:FeDetReq>
      </ar:FeCAEReq>
    </ar:FECAESolicitar>
  </soapenv:Body>
</soapenv:Envelope>`;
}

function mapAlicuotaIvaId(porcentaje: number): number {
  const map: Record<number, number> = {
    0: 3,
    2.5: 9,
    5: 8,
    10.5: 4,
    21: 5,
    27: 6,
  };
  return map[porcentaje] ?? 5;
}

function parseWsfeResponse(xml: string): {
  aprobado: boolean;
  cae: string | null;
  caeVencimiento: string | null;
  errores: Array<{ codigo: string; mensaje: string }>;
  observaciones: Array<{ codigo: string; mensaje: string }>;
} {
  const resultado = extractTag(xml, 'Resultado');
  const cae = extractTag(xml, 'CAE');
  const caeVtoRaw = extractTag(xml, 'CAEFchVto');
  const caeVencimiento =
    caeVtoRaw && /^\d{8}$/.test(caeVtoRaw)
      ? `${caeVtoRaw.slice(0, 4)}-${caeVtoRaw.slice(4, 6)}-${caeVtoRaw.slice(6, 8)}`
      : null;

  const errores = extractMessages(xml, 'Err');
  const observaciones = extractMessages(xml, 'Obs');
  const fault = extractTag(xml, 'faultstring');
  if (fault) {
    errores.push({ codigo: extractTag(xml, 'faultcode') ?? 'SOAP_FAULT', mensaje: fault });
  }

  return {
    aprobado: resultado === 'A' && Boolean(cae),
    cae: cae ?? null,
    caeVencimiento,
    errores,
    observaciones,
  };
}

function extractTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<(?:\\w+:)?${tag}>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, 'i');
  return xml.match(re)?.[1]?.trim() ?? null;
}

function extractMessages(xml: string, blockTag: 'Err' | 'Obs'): Array<{ codigo: string; mensaje: string }> {
  const blockRe = new RegExp(
    `<(?:\\w+:)?${blockTag}>[\\s\\S]*?<\\/(?:\\w+:)?${blockTag}>`,
    'gi',
  );
  const result: Array<{ codigo: string; mensaje: string }> = [];
  for (const match of xml.matchAll(blockRe)) {
    const chunk = match[0];
    const code = extractTag(chunk, 'Code');
    const msg = extractTag(chunk, 'Msg');
    if (code || msg) {
      result.push({ codigo: code ?? 'N/A', mensaje: msg ?? 'Sin detalle' });
    }
  }
  return result;
}
