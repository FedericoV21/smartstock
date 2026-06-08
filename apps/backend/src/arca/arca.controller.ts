import { Body, Controller, Get, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '../auth/decorators/roles.decorator';
import { ArcaHomologationService } from './arca-homologation.service';
import { ArcaAdminService } from './arca-admin.service';
import { EnsureWsaaTicketDto } from './dto/ensure-wsaa-ticket.dto';
import { ListArcaLogsQueryDto } from './dto/list-arca-logs-query.dto';
import { SolicitarCaeDto } from './dto/solicitar-cae.dto';
import { UpsertArcaConfigDto } from './dto/upsert-arca-config.dto';
import { ArcaService } from './arca.service';
import { ArcaWsaaService } from './wsaa/arca-wsaa.service';
import { ArcaWsfeService } from './wsfe/arca-wsfe.service';

@ApiTags('arca')
@ApiBearerAuth('access-token')
@Controller('arca')
export class ArcaController {
  constructor(
    private readonly arcaService: ArcaService,
    private readonly arcaWsaaService: ArcaWsaaService,
    private readonly arcaWsfeService: ArcaWsfeService,
    private readonly homologationService: ArcaHomologationService,
    private readonly arcaAdminService: ArcaAdminService,
  ) {}

  @Get('config')
  @Roles('admin')
  @ApiOperation({ summary: 'Leer configuraci├│n ARCA del tenant (sin exponer secretos)' })
  getConfig() {
    return this.arcaService.getConfig();
  }

  @Put('config')
  @Roles('admin')
  @ApiOperation({ summary: 'Crear/actualizar configuraci├│n ARCA con secretos cifrados' })
  upsertConfig(@Body() dto: UpsertArcaConfigDto) {
    return this.arcaService.upsertConfig(dto);
  }

  @Put('wsaa/ticket')
  @Roles('admin')
  @ApiOperation({ summary: 'Obtener/renovar ticket WSAA vigente' })
  ensureTicket(@Body() dto: EnsureWsaaTicketDto) {
    return this.arcaWsaaService.ensureTicket({ forceRenew: dto.forceRenew ?? false });
  }

  @Put('wsfe/cae')
  @Roles('admin')
  @ApiOperation({ summary: 'Solicitar CAE en WSFE para un comprobante' })
  solicitarCae(@Body() dto: SolicitarCaeDto) {
    return this.arcaWsfeService.solicitarCae(dto);
  }

  @Post('test-connection')
  @Roles('admin')
  @ApiOperation({
    summary: 'Probar conexi├│n WSAA + WSFE (paridad frontend)',
    description: 'Obtiene ticket WSAA y consulta FECompUltimoAutorizado para factura_b.',
  })
  testConnection() {
    return this.arcaAdminService.testConnection();
  }

  @Post('sync-numeracion')
  @Roles('admin')
  @ApiOperation({
    summary: 'Sincronizar numeraci├│n AFIP vs local (factura A/B/C)',
  })
  syncNumeracion() {
    return this.arcaAdminService.syncNumeracion();
  }

  @Get('cert-status')
  @Roles('admin')
  @ApiOperation({ summary: 'Estado de vencimiento del certificado digital' })
  getCertStatus() {
    return this.arcaAdminService.getCertStatus();
  }

  @Get('homologation-readiness')
  @Roles('admin')
  @ApiOperation({
    summary: 'Checklist NB-ARC-106 (pre-requisitos homologaci├│n AFIP)',
    description:
      'Valida env, arca_config, ticket cache y comprobantes pendiente_arca. No llama a AFIP.',
  })
  getHomologationReadiness() {
    return this.homologationService.getReadiness();
  }

  @Get('homologation-evidence')
  @Roles('admin')
  @ApiOperation({
    summary: 'Snapshot anonimizado para archivo de evidencia NB-ARC-106',
    description:
      'Resume readiness, comprobantes recientes (CAE truncado) y logs. No expone certificados ni XML completo.',
  })
  getHomologationEvidence() {
    return this.homologationService.getEvidenceSnapshot();
  }

  @Get('logs')
  @Roles('admin')
  @ApiOperation({
    summary: '├Ültimos logs ARCA (evidencia homologaci├│n)',
    description: 'XML truncado; usar para NB-ARC-106 sin exponer certificados.',
  })
  listLogs(@Query() query: ListArcaLogsQueryDto) {
    return this.homologationService.listLogs(query);
  }
}
