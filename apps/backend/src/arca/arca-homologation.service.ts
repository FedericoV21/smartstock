import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { SucursalContext } from '../branches/sucursal-context.service';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { EstadoComprobante } from '../facturacion/enums/estado-comprobante.enum';
import { ListArcaLogsQueryDto } from './dto/list-arca-logs-query.dto';
import { ArcaConfig } from './entities/arca-config.entity';
import { ArcaLog } from './entities/arca-log.entity';
import { ArcaAmbiente } from './enums/arca-ambiente.enum';

export type HomologationCheck = {
  id: string;
  ok: boolean;
  nivel: 'bloqueante' | 'advertencia' | 'info';
  mensaje: string;
  detalle?: Record<string, unknown>;
};

@Injectable()
export class ArcaHomologationService {
  constructor(
    @InjectRepository(ArcaConfig)
    private readonly arcaConfigRepo: Repository<ArcaConfig>,
    @InjectRepository(ArcaLog)
    private readonly arcaLogRepo: Repository<ArcaLog>,
    @InjectRepository(Comprobante)
    private readonly comprobanteRepo: Repository<Comprobante>,
    @InjectRepository(ModuloConfig)
    private readonly moduloRepo: Repository<ModuloConfig>,
    private readonly tenantContext: TenantContext,
    private readonly sucursalContext: SucursalContext,
    private readonly config: ConfigService,
  ) {}

  async getReadiness() {
    const tenantId = this.tenantContext.getTenantId();
    const sucursalId = await this.sucursalContext.requireSucursalId();
    const checks: HomologationCheck[] = [];

    const encKey = this.config.get<string>('ARCA_ENCRYPTION_KEY', '');
    checks.push({
      id: 'env_arca_encryption_key',
      ok: encKey.length === 32,
      nivel: 'bloqueante',
      mensaje:
        encKey.length === 32
          ? 'ARCA_ENCRYPTION_KEY configurada (32 caracteres).'
          : 'Falta ARCA_ENCRYPTION_KEY de 32 caracteres en el entorno del backend.',
    });

    const jwtSecret = this.config.get<string>('JWT_SECRET') || this.config.get<string>('SUPABASE_JWT_SECRET');
    checks.push({
      id: 'env_jwt_secret',
      ok: Boolean(jwtSecret?.trim()),
      nivel: 'bloqueante',
      mensaje: jwtSecret?.trim()
        ? 'JWT_SECRET (o SUPABASE_JWT_SECRET) presente.'
        : 'Falta JWT_SECRET para autenticar las llamadas API.',
    });

    const workerSecret = this.config.get<string>('ARCA_WORKER_SECRET', '');
    checks.push({
      id: 'env_arca_worker_secret',
      ok: Boolean(workerSecret.trim()),
      nivel: 'advertencia',
      mensaje: workerSecret.trim()
        ? 'ARCA_WORKER_SECRET configurado (cola async).'
        : 'ARCA_WORKER_SECRET vacío: el worker POST /internal/arca-jobs/run no estará disponible.',
    });

    const cronSecret = this.config.get<string>('CRON_SECRET', '');
    checks.push({
      id: 'env_cron_secret',
      ok: Boolean(cronSecret.trim()),
      nivel: 'advertencia',
      mensaje: cronSecret.trim()
        ? 'CRON_SECRET configurado (cron HTTP reintentar-arca / arca-procesar).'
        : 'CRON_SECRET vacío: los endpoints GET /cron/reintentar-arca y POST /cron/arca-procesar no estarán protegidos.',
    });

    const stubEnabled = this.config.get<boolean>('ARCA_WORKER_STUB', false);
    if (stubEnabled) {
      checks.push({
        id: 'env_arca_worker_stub',
        ok: false,
        nivel: 'advertencia',
        mensaje:
          'ARCA_WORKER_STUB=true: el worker asigna CAE ficticio. Desactivar antes de homologaci├│n real AFIP.',
      });
    }

    const modulos = await this.moduloRepo.findOne({ where: { tenantId } });
    checks.push({
      id: 'modulo_facturador_arca',
      ok: modulos?.facturadorArca === true,
      nivel: 'advertencia',
      mensaje: modulos?.facturadorArca
        ? 'M├│dulo facturador_arca habilitado en modulo_config.'
        : 'facturador_arca deshabilitado en modulo_config (recomendado habilitarlo para pruebas).',
    });

    const cfg = await this.arcaConfigRepo.findOne({ where: { tenantId, sucursalId } });
    checks.push({
      id: 'arca_config_existe',
      ok: Boolean(cfg),
      nivel: 'bloqueante',
      mensaje: cfg
        ? 'Configuraci├│n ARCA encontrada para la sucursal activa.'
        : 'Sin fila arca_config para tenant+sucursal.',
      detalle: { sucursal_id: sucursalId },
    });

    if (cfg) {
      checks.push({
        id: 'arca_ambiente_homologacion',
        ok: cfg.ambiente === ArcaAmbiente.homologacion,
        nivel: cfg.ambiente === ArcaAmbiente.homologacion ? 'info' : 'bloqueante',
        mensaje:
          cfg.ambiente === ArcaAmbiente.homologacion
            ? 'Ambiente homologacion.'
            : `Ambiente ${cfg.ambiente}: cambiar a homologacion antes de probar contra AFIP.`,
        detalle: { ambiente: cfg.ambiente },
      });

      checks.push({
        id: 'arca_cuit_punto_venta',
        ok: Boolean(cfg.cuitEmisor?.trim()) && cfg.puntoDeVenta != null,
        nivel: 'bloqueante',
        mensaje:
          cfg.cuitEmisor?.trim() && cfg.puntoDeVenta != null
            ? 'CUIT emisor y punto de venta configurados.'
            : 'Completar cuitEmisor y puntoDeVenta en PUT /arca/config.',
        detalle: { cuit_emisor: cfg.cuitEmisor, punto_de_venta: cfg.puntoDeVenta },
      });

      checks.push({
        id: 'arca_certificados',
        ok: Boolean(cfg.certificadoPem) && Boolean(cfg.clavePrivadaPem),
        nivel: 'bloqueante',
        mensaje:
          cfg.certificadoPem && cfg.clavePrivadaPem
            ? 'Certificado y clave privada cifrados en arca_config (por tenant+sucursal).'
            : 'El cliente debe subir certificadoPem y clavePrivadaPem vía PUT /arca/config (UI /configuracion/arca).',
      });

      const ticketOk = this.isTicketVigente(cfg.ticketExpiracion);
      checks.push({
        id: 'arca_ticket_wsaa',
        ok: ticketOk,
        nivel: ticketOk ? 'info' : 'advertencia',
        mensaje: ticketOk
          ? 'Ticket WSAA vigente en cache.'
          : 'Ticket WSAA ausente o vencido: ejecutar PUT /arca/wsaa/ticket antes del CAE.',
        detalle: { ticket_expiracion: cfg.ticketExpiracion?.toISOString() ?? null },
      });
    }

    const pendientes = await this.comprobanteRepo.find({
      where: { tenantId, estado: EstadoComprobante.pendiente_arca },
      order: { createdAt: 'DESC' },
      take: 5,
      select: { id: true, numero: true, tipo: true, total: true },
    });

    checks.push({
      id: 'comprobante_pendiente_arca',
      ok: pendientes.length > 0,
      nivel: pendientes.length > 0 ? 'info' : 'advertencia',
      mensaje:
        pendientes.length > 0
          ? `${pendientes.length} comprobante(s) pendiente_arca disponibles para WSFE.`
          : 'No hay comprobantes pendiente_arca: emitir uno o usar seed demo.',
      detalle: {
        ids: pendientes.map((c) => c.id),
      },
    });

    const bloqueantes = checks.filter((c) => !c.ok && c.nivel === 'bloqueante').length;
    const advertencias = checks.filter((c) => !c.ok && c.nivel === 'advertencia').length;

    return {
      data: {
        listo_para_homologacion: bloqueantes === 0,
        bloqueantes,
        advertencias,
        checks,
        comprobante_prueba_sugerido: pendientes[0]?.id ?? null,
        flujo_recomendado: [
          'POST /api/v1/branches/active { sucursalId }',
          'GET /api/v1/arca/homologation-readiness',
          'PUT /api/v1/arca/config { sucursalId, cuitEmisor, puntoDeVenta, ambiente, certificadoPem, clavePrivadaPem } — por cliente/sucursal, cifrado en BD',
          'POST /api/v1/arca/test-connection?sucursalId=...',
          'POST /api/v1/arca/sync-numeracion?sucursalId=...',
          'POST /api/v1/facturacion/comprobantes { tipo fiscal, items } ÔÇö emit v9 con CAE inline',
          'GET /api/v1/facturacion/comprobantes/:id/pdf',
          'Alternativa retry: PUT /api/v1/arca/wsaa/ticket ÔåÆ POST .../retry-arca',
          'GET /api/v1/arca/logs',
        ],
        nota: 'NB-ARC-106 requiere ejecuci├│n manual contra AFIP homo y archivo de evidencia (ver homologacion-arca-e2e.md).',
      },
    };
  }

  async getEvidenceSnapshot() {
    const tenantId = this.tenantContext.getTenantId();
    const readiness = await this.getReadiness();

    const comprobantes = await this.comprobanteRepo.find({
      where: {
        tenantId,
        estado: In([
          EstadoComprobante.pendiente_arca,
          EstadoComprobante.error_arca,
          EstadoComprobante.emitido,
        ]),
      },
      order: { createdAt: 'DESC' },
      take: 10,
      select: {
        id: true,
        tipo: true,
        numero: true,
        numeroOrden: true,
        estado: true,
        cae: true,
        caeVencimiento: true,
        intentosArca: true,
        ultimoErrorArcaCodigo: true,
        createdAt: true,
      },
    });

    const logs = await this.arcaLogRepo.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
      take: 20,
    });

    return {
      data: {
        generado_at: new Date().toISOString(),
        readiness: {
          listo_para_homologacion: readiness.data.listo_para_homologacion,
          bloqueantes: readiness.data.bloqueantes,
          advertencias: readiness.data.advertencias,
        },
        comprobantes: comprobantes.map((c) => ({
          id: c.id,
          tipo: c.tipo,
          numero: c.numero,
          numero_orden: c.numeroOrden,
          estado: c.estado,
          cae_ultimos_4: c.cae && c.cae.length >= 4 ? c.cae.slice(-4) : null,
          cae_vencimiento: c.caeVencimiento,
          intentos_arca: c.intentosArca,
          ultimo_error_arca_codigo: c.ultimoErrorArcaCodigo,
          created_at: c.createdAt.toISOString(),
        })),
        logs: logs.map((r) => ({
          id: r.id,
          servicio: r.servicio,
          operacion: r.operacion,
          exitoso: r.exitoso,
          error_codigo: r.errorCodigo,
          comprobante_id: r.comprobanteId,
          created_at: r.createdAt.toISOString(),
        })),
        plantilla_evidencia: 'apps/backend/docs/homologacion-evidencia/TEMPLATE.md',
        nota: 'Copiar TEMPLATE.md → evidencia-YYYY-MM-DD.md y completar casos 1–5 (sin CAE completos ni certificados).',
      },
    };
  }

  async listLogs(query: ListArcaLogsQueryDto) {
    const tenantId = this.tenantContext.getTenantId();
    const limit = query.limit ?? 20;

    const rows = await this.arcaLogRepo.find({
      where: {
        tenantId,
        ...(query.comprobante_id ? { comprobanteId: query.comprobante_id } : {}),
      },
      order: { createdAt: 'DESC' },
      take: limit,
    });

    return {
      data: {
        logs: rows.map((r) => ({
          id: r.id,
          servicio: r.servicio,
          operacion: r.operacion,
          exitoso: r.exitoso,
          error_codigo: r.errorCodigo,
          error_mensaje: r.errorMensaje,
          comprobante_id: r.comprobanteId,
          created_at: r.createdAt.toISOString(),
          request_xml_preview: truncateXml(r.requestXml),
          response_xml_preview: truncateXml(r.responseXml),
        })),
        total: rows.length,
      },
    };
  }

  private isTicketVigente(expiracion: Date | null | undefined): boolean {
    if (!expiracion) return false;
    const marginMs = 5 * 60 * 1000;
    return new Date(expiracion).getTime() - Date.now() > marginMs;
  }
}

function truncateXml(xml: string | null, max = 400): string | null {
  if (!xml) return null;
  const oneLine = xml.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max)}ÔÇª`;
}
