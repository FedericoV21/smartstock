import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { assertCronBearerAuth } from '../cron/cron-auth.util';
import { WhatsappActorsService } from './whatsapp-actors.service';
import { WhatsappBranchRulesService } from './whatsapp-branch-rules.service';
import { WhatsappFeatureFlagService } from './whatsapp-feature-flag.service';
import { WhatsappJobsService } from './whatsapp-jobs.service';
import { WhatsappLogsService } from './whatsapp-logs.service';
import { WhatsappPlatformChannelService } from './whatsapp-platform-channel.service';

@ApiTags('whatsapp')
@ApiBearerAuth('access-token')
@Controller('whatsapp')
export class WhatsappController {
  constructor(
    private readonly channelService: WhatsappPlatformChannelService,
    private readonly featureFlagService: WhatsappFeatureFlagService,
    private readonly branchRulesService: WhatsappBranchRulesService,
    private readonly jobsService: WhatsappJobsService,
    private readonly logsService: WhatsappLogsService,
    private readonly actorsService: WhatsappActorsService,
    private readonly config: ConfigService,
  ) {}

  @Get('channel')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Canal WhatsApp plataforma', description: 'Paridad GET /api/whatsapp/channel' })
  getChannel(@CurrentUser() user: AccessTokenPayload) {
    return this.channelService.getChannel(user);
  }

  @Patch('channel')
  @Roles('admin')
  @ApiOperation({ summary: 'Configurar canal plataforma', description: 'Paridad PATCH /api/whatsapp/channel' })
  patchChannel(@CurrentUser() user: AccessTokenPayload, @Body() body: Record<string, unknown>) {
    return this.channelService.patchChannel(user, body);
  }

  @Get('feature-flag')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Feature flag agente WhatsApp', description: 'Paridad GET /api/whatsapp/feature-flag' })
  getFeatureFlag(@CurrentUser() user: AccessTokenPayload) {
    return this.featureFlagService.getFeatureFlag(user);
  }

  @Patch('feature-flag')
  @Roles('admin')
  @ApiOperation({ summary: 'Actualizar feature flag', description: 'Paridad PATCH /api/whatsapp/feature-flag' })
  patchFeatureFlag(@CurrentUser() user: AccessTokenPayload, @Body() body: Record<string, unknown>) {
    return this.featureFlagService.patchFeatureFlag(user, body);
  }

  @Get('branch-rules')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Reglas de sucursal WhatsApp', description: 'Paridad GET /api/whatsapp/branch-rules' })
  listBranchRules(@CurrentUser() user: AccessTokenPayload) {
    return this.branchRulesService.list(user);
  }

  @Post('branch-rules')
  @Roles('admin', 'operador')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Crear regla de sucursal', description: 'Paridad POST /api/whatsapp/branch-rules' })
  createBranchRule(@CurrentUser() user: AccessTokenPayload, @Body() body: Record<string, unknown>) {
    return this.branchRulesService.create(user, body);
  }

  @Delete('branch-rules')
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Eliminar regla de sucursal', description: 'Paridad DELETE /api/whatsapp/branch-rules?id=' })
  deleteBranchRule(@CurrentUser() user: AccessTokenPayload, @Query('id') id: string) {
    return this.branchRulesService.remove(user, id);
  }

  @Get('jobs')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Listar jobs WhatsApp', description: 'Paridad GET /api/whatsapp/jobs' })
  listJobs(@Query('limit') limit?: string) {
    const parsed = limit != null ? Number.parseInt(limit, 10) : undefined;
    return this.jobsService.listJobs(parsed);
  }

  @Post('jobs')
  @Roles('admin', 'operador')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reprocesar job', description: 'Paridad POST /api/whatsapp/jobs (action=reprocess)' })
  reprocessJob(@CurrentUser() user: AccessTokenPayload, @Body() body: Record<string, unknown>) {
    return this.jobsService.reprocess(user, body);
  }

  @Public()
  @Post('jobs/:id/reprocess')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reencolar job (cron interno)',
    description: 'POST /api/whatsapp/jobs/:id/reprocess con Bearer CRON_SECRET',
  })
  reprocessJobInternal(
    @Param('id') id: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    assertCronBearerAuth(this.config, authorization);
    return this.jobsService.reprocessInternal(id);
  }

  @Get('actors')
  @Roles('admin')
  @ApiOperation({ summary: 'Listar actores OTP', description: 'Paridad GET /api/whatsapp/actors' })
  listActors(@CurrentUser() user: AccessTokenPayload) {
    return this.actorsService.listActors(user);
  }

  @Post('actors')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'OTP link/unlink actores', description: 'Paridad POST /api/whatsapp/actors' })
  postActors(@CurrentUser() user: AccessTokenPayload, @Body() body: Record<string, unknown>) {
    return this.actorsService.handlePost(user, body);
  }

  @Get('logs')
  @Roles('admin')
  @ApiOperation({ summary: 'Logs técnicos agente WhatsApp', description: 'Paridad GET /api/whatsapp/logs' })
  listLogs(
    @CurrentUser() user: AccessTokenPayload,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('actor_id') actorId?: string,
    @Query('channel') channel?: string,
    @Query('status') status?: string,
    @Query('tool') tool?: string,
    @Query('intent') intent?: string,
    @Query('q') q?: string,
  ) {
    return this.logsService.listLogs(user, {
      limit: limit != null ? Number.parseInt(limit, 10) : undefined,
      cursor,
      from,
      to,
      actor_id: actorId,
      channel,
      status,
      tool,
      intent,
      q,
    });
  }
}
