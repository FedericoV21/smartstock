import {
  BadRequestException,
  Controller,
  HttpCode,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { Public } from '../auth/decorators/public.decorator';
import { MpQrWebhookService } from './mp-qr-webhook.service';

function extraerMerchantOrderId(url: URL, body: unknown): string | null {
  const q = url.searchParams.get('data.id')?.trim() || url.searchParams.get('id')?.trim();
  if (q) return q;
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const d = b.data;
  if (d && typeof d === 'object' && (d as Record<string, unknown>).id != null) {
    return String((d as Record<string, unknown>).id).trim() || null;
  }
  if (b.id != null) return String(b.id).trim() || null;
  const resource = b.resource;
  if (typeof resource === 'string' && resource.includes('merchant_orders')) {
    const seg = resource.split('/').filter(Boolean);
    const last = seg[seg.length - 1];
    if (last) return last.split('?')[0].trim() || null;
  }
  return null;
}

function extraerTopic(url: URL, body: unknown): string | null {
  const t = url.searchParams.get('topic')?.trim().toLowerCase();
  if (t) return t;
  if (body && typeof body === 'object') {
    const type = (body as Record<string, unknown>).type;
    if (typeof type === 'string') return type.trim().toLowerCase();
  }
  return null;
}

@ApiTags('pagos')
@Controller('pagos/mp-qr')
export class MpQrWebhookController {
  constructor(private readonly webhookService: MpQrWebhookService) {}

  @Public()
  @Post('webhook')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Webhook Mercado Pago QR (público, sin x-signature)',
    description: 'Paridad POST /api/pagos/mp-qr/webhook. Valida consultando merchant_order en MP.',
  })
  async webhook(
    @Req() req: Request,
    @Query('tenant_id') tenantIdQuery: string | undefined,
    @Query('sucursal_id') sucursalIdQuery: string | undefined,
  ) {
    const url = new URL(`${req.protocol}://${req.get('host')}${req.originalUrl}`);

    let rawBody = '';
    try {
      rawBody =
        typeof req.body === 'string'
          ? req.body
          : req.body && Object.keys(req.body).length > 0
            ? JSON.stringify(req.body)
            : '';
    } catch {
      return { ok: true };
    }

    let parsed: unknown = req.body ?? null;
    if (rawBody.trim() && typeof parsed !== 'object') {
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        parsed = null;
      }
    }

    const topic = extraerTopic(url, parsed);

    if (topic === 'payment') {
      const paymentId =
        url.searchParams.get('data.id')?.trim() ||
        (parsed &&
        typeof parsed === 'object' &&
        (parsed as Record<string, unknown>).data &&
        typeof (parsed as Record<string, unknown>).data === 'object'
          ? String(((parsed as Record<string, unknown>).data as Record<string, unknown>).id ?? '').trim()
          : '');
      const tenantId = tenantIdQuery?.trim();
      if (!paymentId || !tenantId) {
        return { ok: true };
      }
      const sucursalId = sucursalIdQuery?.trim() || null;
      setImmediate(() => {
        void this.webhookService
          .procesarNotificacionMpQrPayment({ paymentId, tenantId, sucursalId })
          .catch(() => {});
      });
      return { ok: true };
    }

    if (topic !== 'merchant_order' && topic !== 'topic_merchant_order_wh') {
      return { ok: true };
    }

    const merchantOrderId = extraerMerchantOrderId(url, parsed);
    const tenantId = tenantIdQuery?.trim();
    const sucursalId = sucursalIdQuery?.trim() || null;

    if (!merchantOrderId) {
      return { ok: true };
    }

    if (!tenantId) {
      throw new BadRequestException('tenant_id requerido en la URL del webhook');
    }

    void this.webhookService.logRecepcion({
      tenantId,
      topic,
      merchantOrderId,
      payloadSnippet: rawBody.slice(0, 2000),
    });

    setImmediate(() => {
      void this.webhookService
        .procesarNotificacionMpQrMerchantOrder({ merchantOrderId, tenantId, sucursalId })
        .catch(() => {});
    });

    return { ok: true };
  }
}
