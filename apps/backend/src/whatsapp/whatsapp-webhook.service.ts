import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { verifyWhatsAppWebhookSignature } from './utils/webhook-signature.util';
import { WhatsappWebhookIngestService } from './whatsapp-webhook-ingest.service';

@Injectable()
export class WhatsappWebhookService {
  constructor(
    private readonly config: ConfigService,
    private readonly ingest: WhatsappWebhookIngestService,
  ) {}

  verifyWebhook(query: Record<string, string | undefined>): string {
    const verifyToken = (this.config.get<string>('WHATSAPP_WEBHOOK_VERIFY_TOKEN') ?? '').trim();
    if (!verifyToken) {
      throw new ServiceUnavailableException('WHATSAPP_WEBHOOK_VERIFY_TOKEN no configurado');
    }

    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    if (mode !== 'subscribe' || token !== verifyToken || !challenge) {
      throw new ForbiddenException('Webhook verification failed');
    }

    return challenge;
  }

  async postWebhook(params: {
    rawBody: string;
    signatureHeader: string | null | undefined;
  }): Promise<{ ok: true; processed: number }> {
    const appSecret = (this.config.get<string>('WHATSAPP_WEBHOOK_APP_SECRET') ?? '').trim();
    const signatureOk = verifyWhatsAppWebhookSignature({
      rawBody: params.rawBody,
      signatureHeader: params.signatureHeader,
      appSecret,
    });
    if (!signatureOk) {
      throw new UnauthorizedException('Unauthorized');
    }

    let body: unknown;
    try {
      body = params.rawBody ? (JSON.parse(params.rawBody) as unknown) : {};
    } catch {
      throw new BadRequestException('JSON invalido');
    }

    return this.ingest.ingest(params.rawBody, body);
  }
}
