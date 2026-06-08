import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyWhatsAppWebhookSignature(params: {
  rawBody: string;
  signatureHeader: string | null | undefined;
  appSecret: string;
}): boolean {
  const appSecret = params.appSecret.trim();
  if (!appSecret) return true;

  const signatureHeader = params.signatureHeader?.trim() ?? '';
  const parts = signatureHeader.split('=');
  if (parts.length !== 2 || parts[0] !== 'sha256' || !parts[1]) return false;

  const expectedHex = createHmac('sha256', appSecret).update(params.rawBody, 'utf8').digest('hex');
  const receivedHex = parts[1].toLowerCase();

  const expected = Buffer.from(expectedHex, 'utf8');
  const received = Buffer.from(receivedHex, 'utf8');
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}
