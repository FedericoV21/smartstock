import * as crypto from 'node:crypto';

import { verifyMercadoPagoWebhookSignature } from './webhook-signature.util';

describe('verifyMercadoPagoWebhookSignature', () => {
  const secret = 'test-webhook-secret';

  function sign(params: {
    dataId: string;
    requestId: string;
    ts: string;
    fromQuery?: boolean;
  }): string {
    const idForManifest =
      params.fromQuery === false && /^[a-zA-Z0-9_-]+$/.test(params.dataId)
        ? params.dataId.toLowerCase()
        : params.dataId;
    const manifest = `id:${idForManifest};request-id:${params.requestId};ts:${params.ts};`;
    const v1 = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
    return `ts=${params.ts},v1=${v1}`;
  }

  it('valida firma con data.id en query', () => {
    const ts = '1700000000';
    const requestId = 'req-1';
    const dataId = 'intent-abc123';
    const xSignature = sign({ dataId, requestId, ts, fromQuery: true });

    expect(
      verifyMercadoPagoWebhookSignature({
        bodyJson: null,
        xSignature,
        xRequestId: requestId,
        queryDataId: dataId,
        secret,
      }),
    ).toBe(true);
  });

  it('rechaza firma inv├ílida', () => {
    expect(
      verifyMercadoPagoWebhookSignature({
        bodyJson: null,
        xSignature: 'ts=1,v1=deadbeef',
        xRequestId: 'req-1',
        queryDataId: 'intent-1',
        secret,
      }),
    ).toBe(false);
  });

  it('extrae data.id del body si no hay query', () => {
    const ts = '1700000001';
    const requestId = 'req-2';
    const dataId = 'intent-from-body';
    const xSignature = sign({ dataId, requestId, ts, fromQuery: false });

    expect(
      verifyMercadoPagoWebhookSignature({
        bodyJson: { data: { id: dataId } },
        xSignature,
        xRequestId: requestId,
        queryDataId: null,
        secret,
      }),
    ).toBe(true);
  });
});
