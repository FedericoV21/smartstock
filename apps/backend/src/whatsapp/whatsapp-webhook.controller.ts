import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { Public } from '../auth/decorators/public.decorator';
import { WhatsappWebhookService } from './whatsapp-webhook.service';

@ApiTags('whatsapp')
@Public()
@SkipThrottle()
@Controller('whatsapp')
export class WhatsappWebhookController {
  constructor(private readonly webhookService: WhatsappWebhookService) {}

  @Get('webhook')
  @ApiOperation({
    summary: 'Verificación webhook Meta',
    description: 'Paridad GET /api/whatsapp/webhook (hub.mode/challenge)',
  })
  verifyWebhook(@Query() query: Record<string, string | undefined>, @Res() res: Response) {
    const challenge = this.webhookService.verifyWebhook(query);
    return res.status(200).send(challenge);
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Webhook inbound Meta',
    description: 'Paridad POST /api/whatsapp/webhook — ingest, routing, jobs',
  })
  async postWebhook(
    @Req() req: Request,
    @Headers('x-hub-signature-256') signatureHeader: string | undefined,
  ) {
    const rawBody =
      (req as Request & { rawBody?: Buffer }).rawBody?.toString('utf8') ??
      (typeof req.body === 'string'
        ? req.body
        : Buffer.isBuffer(req.body)
          ? req.body.toString('utf8')
          : JSON.stringify(req.body ?? {}));

    if (!rawBody && req.body == null) {
      throw new BadRequestException('Body inválido');
    }

    return this.webhookService.postWebhook({ rawBody, signatureHeader });
  }
}
