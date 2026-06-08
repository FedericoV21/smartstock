import { createHmac, timingSafeEqual } from 'node:crypto';

function getWebhookAppSecret(): string {
  return (process.env.WHATSAPP_WEBHOOK_APP_SECRET ?? '').trim();
}

export function verifyWhatsAppWebhookSignature(params: {
  rawBody: string;
  signatureHeader: string | null;
}): boolean {
  const appSecret = getWebhookAppSecret();
  if (!appSecret) return true; // Permite entorno dev si no se configuró secreto.

  const signatureHeader = params.signatureHeader?.trim() ?? '';
  // Meta suele enviar: "sha256=<hex>"
  const parts = signatureHeader.split('=');
  if (parts.length !== 2 || parts[0] !== 'sha256' || !parts[1]) return false;

  const expectedHex = createHmac('sha256', appSecret).update(params.rawBody, 'utf8').digest('hex');
  const receivedHex = parts[1].toLowerCase();

  const expected = Buffer.from(expectedHex, 'utf8');
  const received = Buffer.from(receivedHex, 'utf8');
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}
