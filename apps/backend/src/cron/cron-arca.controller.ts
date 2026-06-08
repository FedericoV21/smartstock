import { Controller, Get, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

import { Public } from '../auth/decorators/public.decorator';
import { ArcaJobWorkerService } from '../arca/arca-job-worker.service';
import { assertCronBearerAuth } from './cron-auth.util';
import { ReintentarArcaCronService } from './reintentar-arca-cron.service';

@ApiTags('cron')
@Public()
@SkipThrottle()
@Controller('cron')
export class CronArcaController {
  constructor(
    private readonly reintentarArcaCron: ReintentarArcaCronService,
    private readonly arcaWorker: ArcaJobWorkerService,
    private readonly config: ConfigService,
  ) {}

  @Get('reintentar-arca')
  @ApiOperation({
    summary: 'Cron: reintentar CAE en comprobantes pendiente_arca',
    description:
      'Paridad GET /api/cron/reintentar-arca. Authorization: Bearer CRON_SECRET. Lote de hasta 10.',
  })
  reintentarArca(@Headers('authorization') authorization: string | undefined) {
    assertCronBearerAuth(this.config, authorization);
    return this.reintentarArcaCron.procesarLote();
  }

  @Post('arca-procesar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cron: procesar cola arca_job',
    description:
      'Paridad POST /api/cron/arca-procesar. Authorization: Bearer CRON_SECRET. Alternativa pública a internal/arca-jobs/run.',
  })
  async arcaProcesar(@Headers('authorization') authorization: string | undefined) {
    assertCronBearerAuth(this.config, authorization);
    const limit = this.config.get<number>('ARCA_WORKER_BATCH_SIZE', 5);
    const data = await this.arcaWorker.claimAndProcess(limit);
    return {
      reset_stale: data.resetStale,
      claimed: data.claimed,
      completed: data.completed,
      failed: data.failed,
      scheduled_retry: data.scheduledRetry,
    };
  }
}
