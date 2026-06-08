import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { LectorFacturaJob } from '../lector-facturas/entities/lector-factura-job.entity';
import { LectorFacturasExtractService } from '../lector-facturas/lector-facturas-extract.service';
import {
  LectorStorageService,
  type LectorJobArchivoRef,
} from '../lector-facturas/lector-storage.service';

const MAX_JOBS_PER_RUN = 10;

@Injectable()
export class CronLectorFacturasService {
  private readonly logger = new Logger(CronLectorFacturasService.name);

  constructor(
    @InjectRepository(LectorFacturaJob)
    private readonly jobRepo: Repository<LectorFacturaJob>,
    private readonly extractService: LectorFacturasExtractService,
    private readonly storage: LectorStorageService,
  ) {}

  processJobsStub() {
    return this.processJobs();
  }

  async processJobs() {
    const jobs = await this.jobRepo.find({
      where: { status: 'queued' },
      order: { createdAt: 'ASC' },
      take: MAX_JOBS_PER_RUN,
    });

    let completed = 0;
    let failed = 0;

    for (const job of jobs) {
      const locked = await this.jobRepo
        .createQueryBuilder()
        .update(LectorFacturaJob)
        .set({ status: 'processing', startedAt: new Date() })
        .where('id = :id', { id: job.id })
        .andWhere('status = :status', { status: 'queued' })
        .execute();

      if (!locked.affected) continue;

      try {
        const archivosRaw = Array.isArray(job.archivos) ? job.archivos : [];
        const archivosEntrada = await this.leerArchivosJob(archivosRaw as LectorJobArchivoRef[]);

        if (archivosEntrada.length === 0) {
          await this.marcarFailed(job.id, 'archivos_no_legibles', 'No se pudieron leer los archivos del job');
          failed += 1;
          continue;
        }

        const source = job.source === 'whatsapp' ? 'whatsapp' : 'api_publica';
        const userId = job.usuarioId ?? job.tenantId;

        const result = await this.extractService.procesarFacturaIa({
          tenantId: job.tenantId,
          userId,
          archivos: archivosEntrada,
          source,
          aplicarRateLimit: false,
          aplicarLimiteMensual: true,
        });

        if (!result.ok) {
          await this.marcarFailed(job.id, String(result.status), result.error);
          failed += 1;
          this.logger.warn(`Job ${job.id} failed: ${result.error}`);
          continue;
        }

        job.status = 'completed';
        job.finishedAt = new Date();
        job.lectorFacturaLogId = result.payload.log_id;
        job.resultado = result.payload as unknown as Record<string, unknown>;
        job.errorCode = null;
        job.errorDetail = null;
        await this.jobRepo.save(job);
        completed += 1;
        this.logger.log(`Job ${job.id} completed, log_id=${result.payload.log_id}`);
      } catch (e) {
        await this.marcarFailed(job.id, 'error', (e as Error).message);
        failed += 1;
        this.logger.error(`Job ${job.id} error: ${(e as Error).message}`);
      }
    }

    return {
      ok: true,
      processed: jobs.length,
      completed,
      failed,
    };
  }

  private async leerArchivosJob(archivos: LectorJobArchivoRef[]) {
    const out: Array<{
      name: string;
      type: string;
      size: number;
      bytes: Uint8Array;
    }> = [];

    for (const archivo of archivos) {
      if (!archivo?.storagePath) continue;
      const bytes = await this.storage.descargarArchivoJob(archivo);
      if (!bytes) continue;
      out.push({
        name: archivo.nombre || 'factura',
        type: archivo.mimeType || 'application/pdf',
        size: archivo.size || bytes.byteLength,
        bytes,
      });
    }

    return out;
  }

  private async marcarFailed(jobId: string, code: string, detail: string) {
    await this.jobRepo.update(jobId, {
      status: 'failed',
      finishedAt: new Date(),
      errorCode: code,
      errorDetail: detail.slice(0, 2000),
    });
  }
}
