import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Repository } from 'typeorm';

import { InternalCronService } from '../cron/internal-cron.service';
import { LectorFacturaJob } from '../lector-facturas/entities/lector-factura-job.entity';
import { RolUsuario } from '../users/enums/rol-usuario.enum';
import { Usuario } from '../users/entities/usuario.entity';
import { WhatsappAgentFeatureFlag } from './entities/whatsapp-agent-feature-flag.entity';
import { WhatsappInboundAttachment } from './entities/whatsapp-inbound-attachment.entity';
import { WhatsappJobEvent } from './entities/whatsapp-job-event.entity';
import { WhatsappProcessingJob } from './entities/whatsapp-processing-job.entity';
import { WhatsappJobStatus } from './enums/whatsapp-job-status.enum';
import {
  inferMimeTypeForJob,
  isAudioDocumentType,
  isMediaDocumentType,
  resolveWhatsAppJobRoute,
} from './utils/job-routing.util';
import { WhatsappLectorJobService } from './whatsapp-lector-job.service';
import { WhatsappMetaService } from './whatsapp-meta.service';
import { WhatsappOutboundService } from './whatsapp-outbound.service';
import { WhatsappStorageService } from './whatsapp-storage.service';
import { WhatsappTextHandlerService } from './whatsapp-text-handler.service';

const STALE_PROCESSING_MS = 8 * 60 * 1000;

export type ProcessQueuedJobsResult = {
  processed: number;
  routed: number;
  failed: number;
  recovered: number;
};

@Injectable()
export class WhatsappProcessQueuedService {
  constructor(
    @InjectRepository(WhatsappProcessingJob)
    private readonly jobRepo: Repository<WhatsappProcessingJob>,
    @InjectRepository(WhatsappInboundAttachment)
    private readonly attachmentRepo: Repository<WhatsappInboundAttachment>,
    @InjectRepository(WhatsappJobEvent)
    private readonly eventRepo: Repository<WhatsappJobEvent>,
    @InjectRepository(WhatsappAgentFeatureFlag)
    private readonly flagRepo: Repository<WhatsappAgentFeatureFlag>,
    @InjectRepository(LectorFacturaJob)
    private readonly lectorJobRepo: Repository<LectorFacturaJob>,
    @InjectRepository(Usuario)
    private readonly usuarioRepo: Repository<Usuario>,
    private readonly meta: WhatsappMetaService,
    private readonly storage: WhatsappStorageService,
    private readonly outbound: WhatsappOutboundService,
    private readonly lectorJobs: WhatsappLectorJobService,
    private readonly internalCron: InternalCronService,
    @Inject(forwardRef(() => WhatsappTextHandlerService))
    private readonly textHandler: WhatsappTextHandlerService,
  ) {}

  private async recoverStaleJobs(): Promise<number> {
    const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS);
    let recovered = 0;

    const staleUntargeted = await this.jobRepo.find({
      where: {
        status: WhatsappJobStatus.processing,
        targetEntityId: IsNull(),
        startedAt: LessThan(staleBefore),
      },
      select: ['id', 'tenantId'],
    });

    for (const row of staleUntargeted) {
      const result = await this.jobRepo.update(
        { id: row.id, status: WhatsappJobStatus.processing },
        {
          status: WhatsappJobStatus.queued,
          startedAt: null,
          errorCode: 'stale_processing_recovered',
          errorDetail: 'Reencolado tras timeout del worker',
        },
      );
      if (result.affected) {
        recovered += 1;
        await this.eventRepo.save({
          tenantId: row.tenantId,
          jobId: row.id,
          eventType: 'stale_processing_requeued',
          eventPayload: { reason: 'untargeted_timeout' },
        });
      }
    }

    const staleFactura = await this.jobRepo.find({
      where: {
        status: WhatsappJobStatus.processing,
        targetEntityType: 'lector_factura_job',
        startedAt: LessThan(staleBefore),
      },
      select: ['id', 'tenantId', 'targetEntityId'],
    });

    for (const row of staleFactura) {
      const lectorId = row.targetEntityId;
      if (!lectorId) continue;

      const lector = await this.lectorJobRepo.findOne({
        where: { id: lectorId },
        select: ['status'],
      });

      if (lector?.status === 'queued') {
        void this.internalCron.trigger('/cron/lector-facturas/process-jobs');
        continue;
      }

      if (lector?.status === 'completed') {
        const result = await this.jobRepo.update(
          { id: row.id, status: WhatsappJobStatus.processing },
          {
            status: WhatsappJobStatus.imported,
            errorCode: null,
            errorDetail: null,
            finishedAt: new Date(),
          },
        );
        if (result.affected) recovered += 1;
        continue;
      }

      if (lector?.status === 'failed') {
        const result = await this.jobRepo.update(
          { id: row.id, status: WhatsappJobStatus.processing },
          {
            status: WhatsappJobStatus.error,
            errorCode: 'lector_factura_job_failed',
            errorDetail: 'Lector finalizó en error; sincronizado por recovery',
            finishedAt: new Date(),
          },
        );
        if (result.affected) recovered += 1;
      }
    }

    return recovered;
  }

  private async pickAutomationUserId(tenantId: string): Promise<string | null> {
    const user = await this.usuarioRepo.findOne({
      where: [
        { tenantId, activo: true, rol: RolUsuario.admin },
        { tenantId, activo: true, rol: RolUsuario.operador },
      ],
      order: { createdAt: 'ASC' },
    });
    return user?.id ?? null;
  }

  private async ensureAttachmentDownloaded(params: {
    tenantId: string;
    inboundAttachmentId: string;
    attachment: WhatsappInboundAttachment;
  }) {
    const { attachment } = params;
    if (attachment.storagePath && attachment.storageBucket) {
      return {
        storageBucket: attachment.storageBucket,
        storagePath: attachment.storagePath,
        mimeType: attachment.mimeType,
        fileSize: attachment.archivoTamano ? Number(attachment.archivoTamano) : null,
        filename: attachment.filename,
      };
    }

    const mediaId = attachment.waMediaId;
    if (!mediaId) throw new Error('wa_media_id faltante');

    const metadata = await this.meta.fetchMediaMetadata(mediaId);
    const media = await this.meta.downloadMedia(metadata.url);
    const mimeType = attachment.mimeType ?? metadata.mime_type ?? media.contentType;
    const fileSize = media.contentLength ?? metadata.file_size ?? media.bytes.byteLength;
    const filename = attachment.filename ?? 'whatsapp-file';

    const uploaded = await this.storage.uploadAttachment({
      tenantId: params.tenantId,
      bytes: media.bytes,
      mimeType,
      filename,
    });

    await this.attachmentRepo.update(params.inboundAttachmentId, {
      storageBucket: uploaded.bucket,
      storagePath: uploaded.path,
      archivoTamano: String(fileSize),
      downloadStatus: 'downloaded',
      downloadedAt: new Date(),
      downloadError: null,
    });

    return {
      storageBucket: uploaded.bucket,
      storagePath: uploaded.path,
      mimeType,
      fileSize,
      filename,
    };
  }

  private async enqueueJobOutbound(params: {
    tenantId: string;
    toWaId: string;
    phoneNumberId: string | null;
    body: string;
    relatedJobId?: string | null;
  }) {
    await this.outbound.enqueue({
      tenantId: params.tenantId,
      toWaId: params.toWaId,
      phoneNumberId: params.phoneNumberId,
      body: params.body,
      relatedJobId: params.relatedJobId ?? null,
    });
  }

  async run(params?: {
    tenantId?: string;
    jobIds?: string[];
    limit?: number;
  }): Promise<ProcessQueuedJobsResult> {
    const limit = Math.min(Math.max(params?.limit ?? 50, 1), 50);
    const recovered = await this.recoverStaleJobs();

    const qb = this.jobRepo
      .createQueryBuilder('j')
      .leftJoinAndSelect('j.inboundAttachment', 'a')
      .where('j.status = :status', { status: WhatsappJobStatus.queued })
      .orderBy('j.createdAt', 'ASC')
      .take(limit);

    if (params?.tenantId) qb.andWhere('j.tenantId = :tenantId', { tenantId: params.tenantId });
    if (params?.jobIds?.length) qb.andWhere('j.id IN (:...ids)', { ids: params.jobIds });

    const jobs = await qb.getMany();

    let processed = 0;
    let routed = 0;
    let failed = 0;

    for (const job of jobs) {
      const lock = await this.jobRepo.update(
        { id: job.id, status: WhatsappJobStatus.queued },
        { status: WhatsappJobStatus.processing, startedAt: new Date() },
      );
      if (!lock.affected) continue;
      processed += 1;

      const attachment = job.inboundAttachment;
      try {
        if (!attachment || !job.inboundAttachmentId) {
          throw new Error('Attachment no encontrado');
        }

        const downloaded = await this.ensureAttachmentDownloaded({
          tenantId: job.tenantId,
          inboundAttachmentId: job.inboundAttachmentId,
          attachment,
        });

        const mimeType = inferMimeTypeForJob({
          mimeType: downloaded.mimeType,
          documentType: job.documentType,
        });
        const route = resolveWhatsAppJobRoute(mimeType);

        if (route.flow === 'unsupported') {
          await this.jobRepo.update(job.id, {
            status: WhatsappJobStatus.review_required,
            documentType: route.documentType,
            errorCode: 'unsupported_mime',
            errorDetail: `MIME no soportado: ${mimeType ?? 'desconocido'}`,
            finishedAt: new Date(),
          });
          await this.eventRepo.save({
            tenantId: job.tenantId,
            jobId: job.id,
            eventType: 'routing_unsupported',
            eventPayload: { mime_type: mimeType },
          });
          if (job.fromWaId) {
            await this.enqueueJobOutbound({
              tenantId: job.tenantId,
              toWaId: job.fromWaId,
              phoneNumberId: job.toPhoneNumberId,
              body: 'Recibí tu archivo, pero el formato no es compatible. Enviá la factura como foto JPG/PNG, PDF o una nota de voz.',
              relatedJobId: job.id,
            });
          }
          continue;
        }

        if (route.flow === 'audio_transcription') {
          const flag = await this.flagRepo.findOne({ where: { tenantId: job.tenantId } });
          if (!flag?.enabled) {
            await this.jobRepo.update(job.id, {
              status: WhatsappJobStatus.review_required,
              documentType: route.documentType,
              errorCode: 'feature_disabled',
              errorDetail: 'whatsapp_agent_feature_flag_disabled',
              finishedAt: new Date(),
            });
            if (job.fromWaId) {
              await this.enqueueJobOutbound({
                tenantId: job.tenantId,
                toWaId: job.fromWaId,
                phoneNumberId: job.toPhoneNumberId,
                body: 'El asistente por voz no está activo para este negocio. Escribí tu consulta por texto.',
                relatedJobId: job.id,
              });
            }
            continue;
          }

          const stubText = '[Transcripción de audio no disponible en este entorno]';
          if (job.fromWaId && job.inboundMessageId) {
            await this.textHandler.handleTextMessage({
              tenantId: job.tenantId,
              fromWaId: job.fromWaId,
              phoneNumberId: job.toPhoneNumberId,
              inboundMessageId: job.inboundMessageId,
              textBody: stubText,
              source: 'audio_stt',
            });
          }

          await this.jobRepo.update(job.id, {
            status: WhatsappJobStatus.imported,
            documentType: route.documentType,
            targetEntityType: 'whatsapp_text_agent',
            targetEntityId: null,
            errorCode: null,
            errorDetail: null,
            finishedAt: new Date(),
          });
          await this.eventRepo.save({
            tenantId: job.tenantId,
            jobId: job.id,
            eventType: 'routed_to_audio_stt_stub',
            eventPayload: { mime_type: mimeType },
          });
          routed += 1;
          continue;
        }

        if (!job.branchId) {
          throw new Error('branch_id faltante para procesar adjunto no-audio');
        }

        const userId = await this.pickAutomationUserId(job.tenantId);
        if (!userId) throw new Error('No hay usuario admin/operador para registrar operación');

        if (route.flow === 'lector_facturas') {
          if (!downloaded.storageBucket || !downloaded.storagePath) {
            throw new Error('Adjunto sin referencia de storage para lector de facturas');
          }

          const lectorJob = await this.lectorJobs.crearLectorFacturaJob({
            tenantId: job.tenantId,
            sucursalId: job.branchId,
            userId,
            source: 'whatsapp',
            whatsappProcessingJobId: job.id,
            externalId: job.id,
            idempotencyKey: job.inboundAttachmentId,
            archivos: [
              {
                nombre: downloaded.filename ?? attachment.filename ?? 'whatsapp-document',
                mimeType: mimeType ?? 'application/octet-stream',
                size: downloaded.fileSize ?? 0,
                storageBucket: downloaded.storageBucket,
                storagePath: downloaded.storagePath,
              },
            ],
          });

          await this.jobRepo.update(job.id, {
            status: WhatsappJobStatus.processing,
            documentType: route.documentType,
            targetEntityType: 'lector_factura_job',
            targetEntityId: lectorJob.id,
            errorCode: null,
            errorDetail: null,
          });

          await this.eventRepo.save({
            tenantId: job.tenantId,
            jobId: job.id,
            eventType: 'routed_to_lector_factura_job',
            eventPayload: {
              lector_factura_job_id: lectorJob.id,
              mime_type: mimeType,
              storage_bucket: downloaded.storageBucket,
              storage_path: downloaded.storagePath,
            },
          });

          if (job.fromWaId) {
            await this.enqueueJobOutbound({
              tenantId: job.tenantId,
              toWaId: job.fromWaId,
              phoneNumberId: job.toPhoneNumberId,
              body: 'Recibí la factura, la estoy procesando con IA. Te aviso cuando tenga el preview listo.',
              relatedJobId: job.id,
            });
          }

          void this.internalCron.trigger('/cron/lector-facturas/process-jobs');
          routed += 1;
          continue;
        }

        if (route.flow === 'importador') {
          await this.jobRepo.update(job.id, {
            status: WhatsappJobStatus.review_required,
            documentType: route.documentType,
            errorCode: 'importador_deferred',
            errorDetail: 'Importador spreadsheet diferido en backend Nest MVP',
            finishedAt: new Date(),
          });
          await this.eventRepo.save({
            tenantId: job.tenantId,
            jobId: job.id,
            eventType: 'routing_importador_deferred',
            eventPayload: { mime_type: mimeType },
          });
          routed += 1;
          continue;
        }
      } catch (e) {
        failed += 1;
        const errorMessage = (e as Error).message;

        await this.jobRepo.update(job.id, {
          status: WhatsappJobStatus.error,
          retryCount: (job.retryCount ?? 0) + 1,
          errorCode: 'routing_failed',
          errorDetail: errorMessage,
          lastErrorAt: new Date(),
          finishedAt: new Date(),
        });

        await this.eventRepo.save({
          tenantId: job.tenantId,
          jobId: job.id,
          eventType: 'routing_error',
          eventPayload: { error: errorMessage },
        });

        if (!job.fromWaId) continue;

        if (isAudioDocumentType(job.documentType)) {
          await this.enqueueJobOutbound({
            tenantId: job.tenantId,
            toWaId: job.fromWaId,
            phoneNumberId: job.toPhoneNumberId,
            body: 'No pude transcribir tu audio en este intento. Probá con un audio más corto o escribime por texto.',
            relatedJobId: job.id,
          });
          continue;
        }

        if (isMediaDocumentType(job.documentType)) {
          await this.enqueueJobOutbound({
            tenantId: job.tenantId,
            toWaId: job.fromWaId,
            phoneNumberId: job.toPhoneNumberId,
            body: `No pude procesar tu archivo en este intento: ${errorMessage}. Probá reenviarlo o contactá al administrador.`,
            relatedJobId: job.id,
          });
        }
      }
    }

    return { processed, routed, failed, recovered };
  }
}
