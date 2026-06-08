import {
  BadRequestException,
  Controller,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { Public } from '../auth/decorators/public.decorator';
import { PasarelasWebhookService } from './pasarelas-webhook.service';

@ApiTags('pagos')
@Controller('pagos/webhook')
export class PasarelasWebhookController {
  constructor(private readonly webhookService: PasarelasWebhookService) {}

  @Public()
  @Post(':proveedor/:webhook_public_id')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Webhook generico multi-pasarela',
    description: 'Paridad POST /api/pagos/webhook/[proveedor]/[webhook_public_id]',
  })
  async webhook(
    @Param('proveedor') proveedor: string,
    @Param('webhook_public_id') webhookPublicId: string,
    @Req() req: Request,
    @Query('data.id') dataIdQuery?: string,
  ) {
    const rawBody =
      typeof req.body === 'string'
        ? req.body
        : Buffer.isBuffer(req.body)
          ? req.body.toString('utf8')
          : JSON.stringify(req.body ?? {});

    let bodyJson: unknown = req.body ?? null;
    if (typeof rawBody === 'string' && rawBody.trim()) {
      try {
        bodyJson = JSON.parse(rawBody);
      } catch {
        bodyJson = null;
      }
    }

    const url = new URL(
      `${req.protocol}://${req.get('host') ?? 'localhost'}${req.originalUrl}`,
    );
    if (dataIdQuery && !url.searchParams.get('data.id')) {
      url.searchParams.set('data.id', dataIdQuery);
    }

    try {
      return await this.webhookService.handleWebhook({
        proveedor,
        webhookPublicId,
        rawBody,
        bodyJson,
        headers: req.headers as Record<string, string | string[] | undefined>,
        url,
      });
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      throw e;
    }
  }
}
