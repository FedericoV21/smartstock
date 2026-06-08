import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { Repository } from 'typeorm';

import { CronLectorFacturasService } from '../cron/cron-lector-facturas.service';
import { LectorFacturaJob } from './entities/lector-factura-job.entity';
import { ApiIntegracionAuthService } from './api-integracion-auth.service';
import { LectorConfirmacionChatbotService } from './lector-confirmacion-chatbot.service';
import { LectorStorageService, type LectorJobArchivoRef } from './lector-storage.service';
import {
  validarArchivosFacturaIa,
  type ArchivoFacturaEntrada,
} from './utils/extraer-factura-ia-pura.util';

@Injectable()
export class LectorFacturasJobsService {
  constructor(
    @InjectRepository(LectorFacturaJob)
    private readonly jobRepo: Repository<LectorFacturaJob>,
    private readonly apiIntegracionAuth: ApiIntegracionAuthService,
    private readonly storage: LectorStorageService,
    private readonly chatbot: LectorConfirmacionChatbotService,
    private readonly moduleRef: ModuleRef,
  ) {}

  async crearJob(params: {
    request: Request;
    archivos: ArchivoFacturaEntrada[];
    externalId?: string | null;
    idempotencyKey?: string | null;
    callbackUrl?: string | null;
    statusUrlBase: string;
  }) {
    const auth = await this.apiIntegracionAuth.authenticate({
      request: params.request,
      scope: 'lector_facturas:jobs:create',
    });

    const idempotencyKey = params.idempotencyKey?.trim() || null;
    if (idempotencyKey) {
      const existing = await this.jobRepo.findOne({
        where: {
          tenantId: auth.tenantId,
          apiKeyId: auth.key.id,
          idempotencyKey,
        },
      });
      if (existing) {
        return {
          job_id: existing.id,
          status: existing.status,
          status_url: `${params.statusUrlBase}/${existing.id}`,
          idempotent_replay: true,
        };
      }
    }

    const validacion = validarArchivosFacturaIa(params.archivos);
    if (!validacion.ok) {
      throw new BadRequestException(validacion.error);
    }

    const archivosGuardados: LectorJobArchivoRef[] = [];
    for (const archivo of params.archivos) {
      archivosGuardados.push(
        await this.storage.subirArchivoLectorFacturaJob({
          tenantId: auth.tenantId,
          source: 'api_publica',
          archivo,
        }),
      );
    }

    const job = await this.jobRepo.save(
      this.jobRepo.create({
        tenantId: auth.tenantId,
        sucursalId: auth.sucursalId,
        usuarioId: auth.userId,
        apiKeyId: auth.key.id,
        source: 'api_publica',
        status: 'queued',
        externalId: params.externalId?.trim() || null,
        idempotencyKey,
        callbackUrl: params.callbackUrl?.trim() || null,
        archivos: archivosGuardados,
      }),
    );

    const cronLector = this.moduleRef.get(CronLectorFacturasService, { strict: false });
    void cronLector?.processJobs().catch(() => undefined);

    return {
      job_id: job.id,
      status: job.status,
      status_url: `${params.statusUrlBase}/${job.id}`,
      idempotent_replay: false,
    };
  }

  async getJob(params: { request: Request; jobId: string }) {
    const auth = await this.apiIntegracionAuth.authenticate({
      request: params.request,
      scope: 'lector_facturas:jobs:read',
      consumeRateLimit: false,
    });

    const job = await this.jobRepo.findOne({
      where: { id: params.jobId, tenantId: auth.tenantId, apiKeyId: auth.key.id },
    });
    if (!job) throw new NotFoundException('Job no encontrado');

    let impacto = job.impactoPreview;
    let impactHash = job.impactHash;
    if (job.status === 'completed' && job.resultado && (!impacto || !impactHash)) {
      const prepared = await this.chatbot.prepararDesdeResultado({
        tenantId: auth.tenantId,
        sucursalId: job.sucursalId ?? auth.sucursalId,
        resultado: job.resultado,
      });
      impacto = prepared.impacto as unknown as Record<string, unknown>;
      impactHash = prepared.impactHash;
      await this.jobRepo.update(job.id, {
        impactoPreview: impacto as never,
        impactHash,
        confirmPayload: prepared.confirmPayload as never,
        applicationStatus:
          prepared.impacto.bloqueantes.length > 0 ? 'blocked' : job.applicationStatus ?? 'pending',
        appliedError:
          prepared.impacto.bloqueantes.length > 0
            ? prepared.impacto.bloqueantes.join(' | ')
            : null,
      });
    }

    return {
      job_id: job.id,
      status: job.status,
      external_id: job.externalId,
      log_id: job.lectorFacturaLogId,
      result: job.status === 'completed' ? job.resultado : null,
      impacto: job.status === 'completed' ? impacto : null,
      impact_hash: job.status === 'completed' ? impactHash : null,
      application_status: job.applicationStatus,
      applied_comprobante_id: job.appliedComprobanteId,
      applied_at: job.appliedAt,
      applied_error: job.appliedError,
      error:
        job.status === 'failed'
          ? { code: job.errorCode, message: job.errorDetail }
          : null,
      created_at: job.createdAt,
      started_at: job.startedAt,
      finished_at: job.finishedAt,
    };
  }

  async confirmarJob(params: {
    request: Request;
    jobId: string;
    body: Record<string, unknown>;
  }) {
    const auth = await this.apiIntegracionAuth.authenticate({
      request: params.request,
      scope: 'lector_facturas:jobs:confirm',
    });

    const job = await this.jobRepo.findOne({
      where: { id: params.jobId, tenantId: auth.tenantId, apiKeyId: auth.key.id },
    });
    if (!job) throw new NotFoundException('Job no encontrado');
    if (job.status !== 'completed') {
      throw new ConflictException('El job todavia no esta completado.');
    }

    const overrides = this.chatbot.parseOverrides(params.body);
    if ('pago' in params.body && params.body.pago != null && overrides.pago == null) {
      throw new BadRequestException('Campo pago invalido');
    }

    const sucursalId = job.sucursalId ?? auth.sucursalId;
    if (!sucursalId) throw new BadRequestException('No hay sucursal operativa asociada al job.');

    const acceptedImpactHash =
      typeof params.body.accepted_impact_hash === 'string'
        ? params.body.accepted_impact_hash.trim()
        : '';
    const confirmed = params.body.confirm === true;

    if (!confirmed || !acceptedImpactHash) {
      const prepared = await this.chatbot.prepararDesdeResultado({
        tenantId: auth.tenantId,
        sucursalId,
        resultado: job.resultado,
        overrides,
      });
      await this.jobRepo.update(job.id, {
        impactoPreview: prepared.impacto as never,
        impactHash: prepared.impactHash,
        confirmPayload: prepared.confirmPayload as never,
        applicationStatus: prepared.impacto.bloqueantes.length > 0 ? 'blocked' : 'pending',
        appliedError:
          prepared.impacto.bloqueantes.length > 0
            ? prepared.impacto.bloqueantes.join(' | ')
            : null,
      });
      throw new ConflictException({
        error: 'Confirmacion requerida con confirm=true y accepted_impact_hash.',
        impacto: prepared.impacto,
        impact_hash: prepared.impactHash,
      });
    }

    try {
      const applied = await this.chatbot.aplicarJob({
        tenantId: auth.tenantId,
        job,
        sucursalId,
        userId: job.usuarioId ?? auth.userId,
        acceptedImpactHash,
        overrides,
      });
      return {
        comprobante_id: applied.comprobante_id,
        actualizaciones_costos: applied.actualizaciones_costos,
        impacto: applied.impacto,
        impact_hash: applied.impact_hash,
        idempotent_replay: applied.idempotent_replay,
      };
    } catch (e) {
      if ((e as Error).message.includes('accepted_impact_hash')) {
        const prepared = await this.chatbot.prepararDesdeResultado({
          tenantId: auth.tenantId,
          sucursalId,
          resultado: job.resultado,
          overrides,
        });
        throw new ConflictException({
          error: (e as Error).message,
          impacto: prepared.impacto,
          impact_hash: prepared.impactHash,
        });
      }
      throw e;
    }
  }
}
