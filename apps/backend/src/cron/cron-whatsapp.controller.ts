import { Controller, Headers, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

import { Public } from '../auth/decorators/public.decorator';
import { assertCronBearerAuth } from './cron-auth.util';
import { CronWhatsappService } from './cron-whatsapp.service';

@ApiTags('cron')
@Public()
@SkipThrottle()
@Controller('cron/whatsapp')
export class CronWhatsappController {
  constructor(
    private readonly cronWhatsapp: CronWhatsappService,
    private readonly config: ConfigService,
  ) {}

  @Post('expire-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cron: expirar OTP WhatsApp pendientes',
    description: 'Paridad POST /api/cron/whatsapp/expire-otp',
  })
  expireOtp(
    @Headers('authorization') authorization: string | undefined,
    @Query('limit') limit?: string,
  ) {
    assertCronBearerAuth(this.config, authorization);
    const parsed = limit != null ? Number.parseInt(limit, 10) : undefined;
    return this.cronWhatsapp.expireOtp(parsed);
  }

  @Post('purge-agent-logs')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cron: purgar logs de turnos del agente',
    description: 'Paridad POST /api/cron/whatsapp/purge-agent-logs',
  })
  purgeAgentLogs(@Headers('authorization') authorization: string | undefined) {
    assertCronBearerAuth(this.config, authorization);
    return this.cronWhatsapp.purgeAgentLogs();
  }

  @Post('branch-timeout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cron: timeout confirmación de sucursal',
    description: 'Paridad POST /api/cron/whatsapp/branch-timeout',
  })
  branchTimeout(@Headers('authorization') authorization: string | undefined) {
    assertCronBearerAuth(this.config, authorization);
    return this.cronWhatsapp.branchTimeout();
  }

  @Post('send-outbound')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cron: enviar cola outbound',
    description: 'Paridad POST /api/cron/whatsapp/send-outbound',
  })
  sendOutbound(
    @Headers('authorization') authorization: string | undefined,
    @Query('limit') limit?: string,
  ) {
    assertCronBearerAuth(this.config, authorization);
    const parsed = limit != null ? Number.parseInt(limit, 10) : undefined;
    return this.cronWhatsapp.sendOutbound(parsed);
  }

  @Post('process-queued')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cron: procesar jobs en cola',
    description: 'Paridad POST /api/cron/whatsapp/process-queued',
  })
  processQueued(
    @Headers('authorization') authorization: string | undefined,
    @Query('limit') limit?: string,
  ) {
    assertCronBearerAuth(this.config, authorization);
    const parsed = limit != null ? Number.parseInt(limit, 10) : undefined;
    return this.cronWhatsapp.processQueuedJobs(parsed);
  }
}
