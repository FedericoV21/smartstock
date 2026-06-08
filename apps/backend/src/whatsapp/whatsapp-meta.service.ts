import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { downloadWhatsAppMedia, fetchWhatsAppMediaMetadata } from './utils/meta-media.util';
import { sendWhatsAppDocumentMessage, sendWhatsAppTextMessage } from './utils/meta-send.util';

@Injectable()
export class WhatsappMetaService {
  constructor(private readonly config: ConfigService) {}

  private accessToken(): string {
    const token = (this.config.get<string>('WHATSAPP_ACCESS_TOKEN') ?? '').trim();
    if (!token) throw new Error('WHATSAPP_ACCESS_TOKEN no configurado');
    return token;
  }

  private apiVersion(): string {
    return (this.config.get<string>('WHATSAPP_GRAPH_API_VERSION') ?? 'v20.0').trim() || 'v20.0';
  }

  async sendText(params: { phoneNumberId: string; toWaId: string; body: string }) {
    return sendWhatsAppTextMessage({
      accessToken: this.accessToken(),
      apiVersion: this.apiVersion(),
      phoneNumberId: params.phoneNumberId,
      toWaId: params.toWaId,
      body: params.body,
    });
  }

  async sendDocument(params: {
    phoneNumberId: string;
    toWaId: string;
    link: string;
    filename?: string | null;
    caption?: string | null;
  }) {
    return sendWhatsAppDocumentMessage({
      accessToken: this.accessToken(),
      apiVersion: this.apiVersion(),
      phoneNumberId: params.phoneNumberId,
      toWaId: params.toWaId,
      link: params.link,
      filename: params.filename,
      caption: params.caption,
    });
  }

  async fetchMediaMetadata(mediaId: string) {
    return fetchWhatsAppMediaMetadata(this.accessToken(), this.apiVersion(), mediaId);
  }

  async downloadMedia(mediaUrl: string) {
    return downloadWhatsAppMedia(this.accessToken(), mediaUrl);
  }
}
