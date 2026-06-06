import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { Public } from '../auth/decorators/public.decorator';
import { MpPointWebhookService } from './mp-point-webhook.service';

function extraerIntentIdDesdeBody(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const d = (body as Record<string, unknown>).data;
  if (d && typeof d === 'object' && (d as Record<string, unknown>).id != null) {
    return String((d as Record<string, unknown>).id);
  }
  return null;
}

function normalizarIntentId(id: string | null | undefined): string | null {
  const t = id?.trim();
  return t ? t : null;
}

@ApiTags('pagos')
@Controller('pagos/mp-point')
export class MpPointWebhookController {
  constructor(private readonly webhookService: MpPointWebhookService) {}

  @Public()
  @Post('webhook')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Webhook Mercado Pago Point (p├║blico, firma x-signature)',
    description: 'Paridad POST /api/pagos/mp-point/webhook. Responde 200 y procesa async.',
  })
  async webhook(
    @Req() req: Request,
    @Query('data.id') dataIdQuery: string | undefined,
    @Body() body: unknown,
    @Headers('x-signature') xSignature: string | undefined,
    @Headers('x-request-id') xRequestId: string | undefined,
  ) {
    const intentId =
      normalizarIntentId(dataIdQuery) ??
      extraerIntentIdDesdeBody(body) ??
      extraerIntentIdDesdeBody(req.body);

    if (!intentId) {
      return { ok: true };
    }

    try {
      return await this.webhookService.handleWebhookHttp({
        intentId,
        bodyJson: body ?? req.body ?? null,
        xSignature: xSignature ?? null,
        xRequestId: xRequestId ?? null,
        queryDataId: dataIdQuery ?? null,
      });
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        throw err;
      }
      throw new BadRequestException('Error procesando webhook');
    }
  }
}
