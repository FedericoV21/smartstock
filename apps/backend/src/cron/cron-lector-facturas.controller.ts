import { Controller, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

import { Public } from '../auth/decorators/public.decorator';
import { assertCronBearerAuth } from './cron-auth.util';
import { CronLectorFacturasService } from './cron-lector-facturas.service';

@ApiTags('cron')
@Public()
@SkipThrottle()
@Controller('cron/lector-facturas')
export class CronLectorFacturasController {
  constructor(
    private readonly cronLectorFacturas: CronLectorFacturasService,
    private readonly config: ConfigService,
  ) {}

  @Post('process-jobs')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cron: procesar jobs lector facturas',
    description: 'Paridad POST /api/cron/lector-facturas/process-jobs',
  })
  processJobs(@Headers('authorization') authorization: string | undefined) {
    assertCronBearerAuth(this.config, authorization);
    return this.cronLectorFacturas.processJobsStub();
  }
}
