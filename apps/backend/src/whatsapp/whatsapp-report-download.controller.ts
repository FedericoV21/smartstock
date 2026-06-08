import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  GoneException,
  NotFoundException,
  Query,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { Public } from '../auth/decorators/public.decorator';
import {
  isAllowedReportBucket,
  isSafeStoragePath,
  parseAndVerifyReportToken,
  reportLinkSecret,
} from './utils/whatsapp-report-link.util';
import { WhatsappStorageService } from './whatsapp-storage.service';

@ApiTags('whatsapp')
@Controller('whatsapp/report')
export class WhatsappReportDownloadController {
  constructor(
    private readonly config: ConfigService,
    private readonly storage: WhatsappStorageService,
  ) {}

  @Public()
  @Get('download')
  @ApiOperation({
    summary: 'Descarga firmada de reporte PDF',
    description: 'Paridad GET /api/whatsapp/report/download?t=',
  })
  async download(@Query('t') tokenRaw: string | undefined, @Res() res: Response): Promise<void> {
    const token = tokenRaw?.trim();
    if (!token) {
      throw new BadRequestException({ error: 'Token requerido' });
    }

    const secret = reportLinkSecret(process.env);
    const payload = parseAndVerifyReportToken(token, secret);
    if (!payload) {
      throw new ForbiddenException({ error: 'Token inválido' });
    }

    if (payload.e < Date.now()) {
      throw new GoneException({ error: 'Enlace vencido' });
    }

    if (!isAllowedReportBucket(payload.b) || !isSafeStoragePath(payload.p)) {
      throw new ForbiddenException({ error: 'Enlace no permitido' });
    }

    const secondsRemaining = Math.trunc((payload.e - Date.now()) / 1000);
    const defaultTtl = Number(this.config.get('WHATSAPP_REPORT_SIGNED_URL_TTL_SECONDS') ?? 3600);
    const signTtl = Math.max(60, Math.min(defaultTtl, secondsRemaining));

    const signedUrl = await this.storage.createPresignedDownloadUrl(payload.p, signTtl);
    if (!signedUrl) {
      throw new NotFoundException({ error: 'No se pudo generar la descarga' });
    }

    res.redirect(307, signedUrl);
  }
}
