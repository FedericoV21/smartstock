import * as crypto from 'node:crypto';

/**
 * Valida x-signature de Mercado Pago (manifest id + request-id + ts).
 * @see https://www.mercadopago.com.ar/developers/en/docs/your-integrations/notifications/webhooks
 */
export function verifyMercadoPagoWebhookSignature(params: {
  bodyJson: unknown;
  xSignature: string | null;
  xRequestId: string | null;
  queryDataId: string | null;
  secret: string;
}): boolean {
  const { xSignature, xRequestId, queryDataId, secret } = params;
  if (!xSignature || !secret) return false;

  let ts = '';
  let v1 = '';
  for (const part of xSignature.split(',')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (key === 'ts') ts = val;
    if (key === 'v1') v1 = val;
  }
  if (!ts || !v1) return false;

  let dataId = queryDataId ?? '';
  if (!dataId && params.bodyJson && typeof params.bodyJson === 'object') {
    const d = (params.bodyJson as Record<string, unknown>).data;
    if (d && typeof d === 'object' && (d as Record<string, unknown>).id != null) {
      const id = String((d as Record<string, unknown>).id);
      dataId = /^[a-zA-Z0-9_-]+$/.test(id) ? id.toLowerCase() : id;
    }
  }

  const manifestParts: string[] = [];
  if (dataId) manifestParts.push(`id:${dataId}`);
  if (xRequestId) manifestParts.push(`request-id:${xRequestId}`);
  manifestParts.push(`ts:${ts}`);
  const manifest = `${manifestParts.join(';')};`;

  const h = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  if (h.length !== v1.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(h, 'utf8'), Buffer.from(v1, 'utf8'));
  } catch {
    return false;
  }
}
