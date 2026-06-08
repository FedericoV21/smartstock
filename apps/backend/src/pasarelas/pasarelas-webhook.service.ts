import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { MpPointWebhookService } from '../mp-point/mp-point-webhook.service';
import { MpQrWebhookService } from '../mp-qr/mp-qr-webhook.service';
import { PasarelaIntegracion } from './entities/pasarela-integracion.entity';
import { PasarelaWebhookLog } from './entities/pasarela-webhook-log.entity';
import { PasarelaPaymentAdaptersService } from './pasarela-payment-adapters.service';

function normalizar(value: string | null | undefined): string | null {
  const t = value?.trim();
  return t ? t : null;
}

function extraerTopic(url: URL, body: unknown): string | null {
  const q = normalizar(url.searchParams.get('topic'))?.toLowerCase();
  if (q) return q;
  if (body && typeof body === 'object') {
    const type = (body as Record<string, unknown>).type;
    if (typeof type === 'string') return normalizar(type)?.toLowerCase() ?? null;
  }
  return null;
}

function extraerIntentId(url: URL, body: unknown): string | null {
  const q = normalizar(url.searchParams.get('data.id'));
  if (q) return q;
  if (!body || typeof body !== 'object') return null;
  const d = (body as Record<string, unknown>).data;
  if (d && typeof d === 'object' && (d as Record<string, unknown>).id != null) {
    return normalizar(String((d as Record<string, unknown>).id));
  }
  return null;
}

function extraerMerchantOrderId(url: URL, body: unknown): string | null {
  const q = normalizar(url.searchParams.get('data.id')) ?? normalizar(url.searchParams.get('id'));
  if (q) return q;
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const d = b.data;
  if (d && typeof d === 'object' && (d as Record<string, unknown>).id != null) {
    return normalizar(String((d as Record<string, unknown>).id));
  }
  if (b.id != null) return normalizar(String(b.id));
  const resource = b.resource;
  if (typeof resource === 'string' && resource.includes('merchant_orders')) {
    const last = resource.split('/').filter(Boolean).at(-1);
    return normalizar(last?.split('?')[0]);
  }
  return null;
}

function extraerPaymentId(url: URL, body: unknown): string | null {
  const topic = extraerTopic(url, body);
  if (topic !== 'payment') return null;
  return extraerMerchantOrderId(url, body);
}

function headersParaLog(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const k = key.toLowerCase();
    if (!k.startsWith('x-') && k !== 'user-agent') continue;
    const v = Array.isArray(value) ? value[0] : value;
    if (typeof v === 'string') out[k] = v.slice(0, 500);
  }
  return out;
}

@Injectable()
export class PasarelasWebhookService {
  private readonly logger = new Logger(PasarelasWebhookService.name);

  constructor(
    @InjectRepository(PasarelaIntegracion)
    private readonly integracionRepo: Repository<PasarelaIntegracion>,
    @InjectRepository(PasarelaWebhookLog)
    private readonly webhookLogRepo: Repository<PasarelaWebhookLog>,
    private readonly paymentAdapters: PasarelaPaymentAdaptersService,
    private readonly mpPointWebhookService: MpPointWebhookService,
    private readonly mpQrWebhookService: MpQrWebhookService,
  ) {}

  async handleWebhook(params: {
    proveedor: string;
    webhookPublicId: string;
    rawBody: string;
    bodyJson: unknown;
    headers: Record<string, string | string[] | undefined>;
    url: URL;
  }): Promise<{ ok: true; ignored?: boolean }> {
    const proveedor = normalizar(params.proveedor)?.toLowerCase();
    const webhookPublicId = normalizar(params.webhookPublicId);
    if (!proveedor || !webhookPublicId) {
      throw new BadRequestException('webhook invalido');
    }

    const integracion = await this.integracionRepo.findOne({
      where: { proveedor, webhookPublicId },
    });
    if (!integracion) {
      throw new NotFoundException('Integracion no encontrada');
    }

    if (integracion.tipo !== 'mp_point' && integracion.tipo !== 'mp_qr') {
      return { ok: true, ignored: true };
    }

    const headerGet = (name: string) => {
      const v = params.headers[name.toLowerCase()] ?? params.headers[name];
      return Array.isArray(v) ? v[0] : v ?? null;
    };

    const verified = this.paymentAdapters.verifyWebhook({
      integracion,
      rawBody: params.rawBody,
      bodyJson: params.bodyJson,
      headers: { get: headerGet },
      queryDataId: params.url.searchParams.get('data.id'),
    });
    if (!verified) {
      throw new UnauthorizedException('Unauthorized');
    }

    const topic = extraerTopic(params.url, params.bodyJson);
    const eventId =
      integracion.tipo === 'mp_point'
        ? extraerIntentId(params.url, params.bodyJson)
        : integracion.tipo === 'mp_qr'
          ? topic === 'payment'
            ? extraerPaymentId(params.url, params.bodyJson)
            : extraerMerchantOrderId(params.url, params.bodyJson)
          : null;

    let logId: string | null = null;
    try {
      const logRow = await this.webhookLogRepo.save(
        this.webhookLogRepo.create({
          tenantId: integracion.tenantId,
          integracionId: integracion.id,
          proveedor,
          webhookPublicId,
          eventId,
          topic,
          payloadSnippet: params.rawBody.slice(0, 2000),
          headers: headersParaLog(params.headers),
          procesado: false,
          resultado: 'recibido',
        }),
      );
      logId = logRow.id;
    } catch (e) {
      this.logger.warn('insert webhook log', e);
    }

    if (integracion.tipo === 'mp_point') {
      const intentId = extraerIntentId(params.url, params.bodyJson);
      if (!intentId) {
        await this.marcarLog(logId, { procesado: true, resultado: 'ignorado_sin_intent' });
        return { ok: true };
      }
      void this.procesarMpPointAsync(intentId, logId);
      return { ok: true };
    }

    if (integracion.tipo === 'mp_qr') {
      if (topic === 'payment') {
        const paymentId = extraerPaymentId(params.url, params.bodyJson);
        if (!paymentId) {
          await this.marcarLog(logId, { procesado: true, resultado: 'ignorado_payment_sin_id' });
          return { ok: true };
        }
        void this.procesarMpQrPaymentAsync(paymentId, integracion, logId);
        return { ok: true };
      }
      if (topic !== 'merchant_order' && topic !== 'topic_merchant_order_wh') {
        await this.marcarLog(logId, { procesado: true, resultado: 'ignorado_topic' });
        return { ok: true };
      }
      const merchantOrderId = extraerMerchantOrderId(params.url, params.bodyJson);
      if (!merchantOrderId) {
        await this.marcarLog(logId, { procesado: true, resultado: 'ignorado_sin_merchant_order' });
        return { ok: true };
      }
      void this.procesarMpQrMerchantOrderAsync(merchantOrderId, integracion, logId);
      return { ok: true };
    }

    await this.marcarLog(logId, { procesado: true, resultado: 'ignorado_adapter_sin_proceso' });
    return { ok: true, ignored: true };
  }

  private async marcarLog(
    logId: string | null,
    patch: { procesado: boolean; resultado: string; errorMensaje?: string },
  ) {
    if (!logId) return;
    await this.webhookLogRepo.update({ id: logId }, patch);
  }

  private async procesarMpPointAsync(intentId: string, logId: string | null) {
    try {
      await this.mpPointWebhookService.procesarNotificacionMpPointIntent({ intentId });
      await this.marcarLog(logId, { procesado: true, resultado: 'procesado' });
    } catch (e) {
      this.logger.error('pasarela webhook mp_point', e);
      await this.marcarLog(logId, {
        procesado: false,
        resultado: 'error',
        errorMensaje: String(e),
      });
    }
  }

  private async procesarMpQrPaymentAsync(
    paymentId: string,
    integracion: PasarelaIntegracion,
    logId: string | null,
  ) {
    try {
      await this.mpQrWebhookService.procesarNotificacionMpQrPayment({
        paymentId,
        tenantId: integracion.tenantId,
        sucursalId: integracion.sucursalId,
      });
      await this.marcarLog(logId, { procesado: true, resultado: 'procesado_payment' });
    } catch (e) {
      this.logger.error('pasarela webhook mp_qr payment', e);
      await this.marcarLog(logId, {
        procesado: false,
        resultado: 'error',
        errorMensaje: String(e),
      });
    }
  }

  private async procesarMpQrMerchantOrderAsync(
    merchantOrderId: string,
    integracion: PasarelaIntegracion,
    logId: string | null,
  ) {
    try {
      await this.mpQrWebhookService.procesarNotificacionMpQrMerchantOrder({
        merchantOrderId,
        tenantId: integracion.tenantId,
        sucursalId: integracion.sucursalId,
      });
      await this.marcarLog(logId, { procesado: true, resultado: 'procesado' });
    } catch (e) {
      this.logger.error('pasarela webhook mp_qr merchant_order', e);
      await this.marcarLog(logId, {
        procesado: false,
        resultado: 'error',
        errorMensaje: String(e),
      });
    }
  }
}
