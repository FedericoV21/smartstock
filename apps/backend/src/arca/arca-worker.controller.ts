import {
  Controller,
  Headers,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

import { Public } from '../auth/decorators/public.decorator';
import { ArcaJobWorkerService } from './arca-job-worker.service';

@ApiTags('internal')
@Public()
@SkipThrottle()
@Controller('internal/arca-jobs')
export class ArcaWorkerController {
  constructor(
    private readonly worker: ArcaJobWorkerService,
    private readonly config: ConfigService,
  ) {}

  @Post('run')
  @ApiOperation({
    summary: 'Procesar lote de arca_job (worker)',
    description:
      'Requiere header `x-arca-worker-secret` igual a `ARCA_WORKER_SECRET`. Reclama filas con `claim_arca_jobs`.',
  })
  async run(@Headers('x-arca-worker-secret') secret: string | undefined) {
    const expected = this.config.get<string>('ARCA_WORKER_SECRET', '');
    if (!expected) {
      throw new ServiceUnavailableException('ARCA_WORKER_SECRET no configurado');
    }
    if (secret !== expected) {
      throw new UnauthorizedException();
    }
    const batch = this.config.get<number>('ARCA_WORKER_BATCH_SIZE', 5);
    const data = await this.worker.claimAndProcess(batch);
    return { data };
  }
}
