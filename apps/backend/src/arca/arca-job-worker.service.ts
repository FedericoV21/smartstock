import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { ComprobantePdfRegenerationService } from '../facturacion/pdf/comprobante-pdf-regeneration.service';
import { EstadoComprobante } from '../facturacion/enums/estado-comprobante.enum';
import { ArcaConfig } from './entities/arca-config.entity';
import { ArcaLog } from './entities/arca-log.entity';
import { ArcaAmbiente } from './enums/arca-ambiente.enum';
import { ArcaWsfeService } from './wsfe/arca-wsfe.service';

type ClaimedJobRow = {
  id: string;
  tenant_id: string;
  comprobante_id: string;
  attempts: number;
  max_attempts: number;
};

@Injectable()
export class ArcaJobWorkerService {
  private readonly logger = new Logger(ArcaJobWorkerService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly wsfe: ArcaWsfeService,
    private readonly pdfRegeneration: ComprobantePdfRegenerationService,
    @InjectRepository(Comprobante)
    private readonly comprobanteRepo: Repository<Comprobante>,
    @InjectRepository(ArcaConfig)
    private readonly arcaConfigRepo: Repository<ArcaConfig>,
    @InjectRepository(ArcaLog)
    private readonly arcaLogRepo: Repository<ArcaLog>,
  ) {}

  async resetStaleJobs(staleMinutes = 15): Promise<number> {
    const rows = (await this.dataSource.query('SELECT public.reset_stale_arca_jobs($1) AS n', [
      staleMinutes,
    ])) as Array<{ n: string | number }>;
    return Number(rows[0]?.n ?? 0);
  }

  async claimAndProcess(limit: number): Promise<{
    resetStale: number;
    claimed: number;
    completed: number;
    failed: number;
    scheduledRetry: number;
  }> {
    const resetStale = await this.resetStaleJobs(15);
    const rawJobs = (await this.dataSource.query('SELECT * FROM public.claim_arca_jobs($1)', [
      limit,
    ])) as ClaimedJobRow[];

    let completed = 0;
    let failed = 0;
    let scheduledRetry = 0;

    for (const row of rawJobs) {
      const job: ClaimedJobRow = {
        id: row.id,
        tenant_id: row.tenant_id,
        comprobante_id: row.comprobante_id,
        attempts: Number(row.attempts),
        max_attempts: Number(row.max_attempts),
      };

      try {
        if (await this.maybeStubHomologacion(job.tenant_id, job.comprobante_id)) {
          await this.completeJob(job.id);
          completed += 1;
          continue;
        }

        const res = await this.wsfe.solicitarCaeForTenant(job.tenant_id, {
          comprobanteId: job.comprobante_id,
        });
        const d = res.data;

        if (d.estado === 'aprobado') {
          await this.completeJob(job.id);
          completed += 1;
          continue;
        }

        if (d.estado === 'rechazado') {
          const msg = d.errores.map((e) => `${e.codigo}: ${e.mensaje}`).join('; ') || 'Rechazo WSFE';
          await this.failJob(job.id, msg);
          failed += 1;
          continue;
        }

        const pendMsg = d.errores.map((e) => `${e.codigo}: ${e.mensaje}`).join('; ') || 'Pendiente WSFE';
        const didSchedule = await this.retryOrFailJob(job, pendMsg);
        if (didSchedule) {
          scheduledRetry += 1;
        } else {
          failed += 1;
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (error instanceof NotFoundException || error instanceof BadRequestException) {
          await this.failJob(job.id, msg);
          failed += 1;
          continue;
        }
        const didSchedule = await this.retryOrFailJob(job, msg);
        if (didSchedule) {
          scheduledRetry += 1;
        } else {
          failed += 1;
        }
        if (!(error instanceof ServiceUnavailableException)) {
          this.logger.warn(`arca_job ${job.id}: ${msg}`);
        }
      }
    }

    return {
      resetStale,
      claimed: rawJobs.length,
      completed,
      failed,
      scheduledRetry,
    };
  }

  /** @returns `true` si aplic├│ stub y no debe llamarse WSFE real. */
  private async maybeStubHomologacion(tenantId: string, comprobanteId: string): Promise<boolean> {
    const stubRaw = this.config.get('ARCA_WORKER_STUB');
    const stub =
      stubRaw === true ||
      stubRaw === 'true' ||
      stubRaw === 1 ||
      stubRaw === '1';
    if (!stub) {
      return false;
    }

    const c = await this.comprobanteRepo.findOne({ where: { id: comprobanteId, tenantId } });
    if (!c) {
      throw new NotFoundException('Comprobante no encontrado para stub ARCA');
    }
    if (c.cae) {
      return true;
    }
    if (!c.sucursalId) {
      this.logger.warn('ARCA_WORKER_STUB ignorado: comprobante sin sucursal_id');
      return false;
    }

    const cfg = await this.arcaConfigRepo.findOne({
      where: { tenantId, sucursalId: c.sucursalId },
    });
    if (!cfg || cfg.ambiente !== ArcaAmbiente.homologacion) {
      this.logger.warn('ARCA_WORKER_STUB ignorado: requiere arca_config.ambiente = homologacion');
      return false;
    }

    c.cae = `HOMO-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const vto = new Date();
    vto.setUTCDate(vto.getUTCDate() + 10);
    c.caeVencimiento = vto.toISOString().slice(0, 10);
    c.estado = EstadoComprobante.emitido;
    await this.comprobanteRepo.save(c);

    await this.arcaLogRepo.save(
      this.arcaLogRepo.create({
        tenantId,
        comprobanteId,
        servicio: 'WSFE',
        operacion: 'FECAESolicitar_STUB',
        requestXml: null,
        responseXml: '<stub homologacion="true"/>',
        exitoso: true,
        errorCodigo: null,
        errorMensaje: null,
      }),
    );

    try {
      await this.pdfRegeneration.persistPostCaePdfToStorage(tenantId, comprobanteId);
    } catch {
      /* best-effort */
    }

    return true;
  }

  private async completeJob(jobId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE public.arca_job
       SET status = 'completed', last_error = NULL, next_attempt_at = NULL, updated_at = now()
       WHERE id = $1::uuid`,
      [jobId],
    );
  }

  private async failJob(jobId: string, message: string): Promise<void> {
    const trimmed = message.slice(0, 4000);
    await this.dataSource.query(
      `UPDATE public.arca_job
       SET status = 'failed', last_error = $2, updated_at = now()
       WHERE id = $1::uuid`,
      [jobId, trimmed],
    );
  }

  /** @returns `true` si program├│ reintento, `false` si marc├│ failed por agotar intentos. */
  private async retryOrFailJob(job: ClaimedJobRow, message: string): Promise<boolean> {
    const trimmed = message.slice(0, 4000);
    if (job.attempts >= job.max_attempts) {
      await this.failJob(job.id, trimmed);
      return false;
    }
    const backoffSec = Math.min(300, Math.pow(2, Math.min(job.attempts, 8)));
    await this.dataSource.query(
      `UPDATE public.arca_job
       SET status = 'pending',
           last_error = $2,
           next_attempt_at = now() + ($3::double precision * interval '1 second'),
           updated_at = now()
       WHERE id = $1::uuid`,
      [job.id, trimmed, backoffSec],
    );
    return true;
  }
}
