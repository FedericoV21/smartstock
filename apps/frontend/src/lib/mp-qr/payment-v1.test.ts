import { describe, expect, it } from 'vitest';

import {
  buscarMerchantOrderIdPorExternalReference,
  fetchMercadoPagoPaymentV1Detalle,
} from '@/lib/mp-qr/payment-v1';

describe('fetchMercadoPagoPaymentV1Detalle', () => {
  it('parsea order.id como merchant_order_id', async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          id: 160024701092,
          status: 'approved',
          external_reference: 'cf3f3ea6-3ffd-484d-9062-2fa51ec2d7eb',
          order: { id: '99887766', type: 'mercadopago' },
          transaction_amount: 600,
        }),
        { status: 200 },
      );
    const pay = await fetchMercadoPagoPaymentV1Detalle('tok', 160024701092, { fetchImpl });
    expect(pay?.merchant_order_id).toBe('99887766');
    expect(pay?.external_reference).toBe('cf3f3ea6-3ffd-484d-9062-2fa51ec2d7eb');
    expect(pay?.status).toBe('approved');
  });
});

describe('buscarMerchantOrderIdPorExternalReference', () => {
  it('toma el primer elemento de elements', async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ elements: [{ id: 12345 }] }), { status: 200 });
    const id = await buscarMerchantOrderIdPorExternalReference('tok', 'ref-1', { fetchImpl });
    expect(id).toBe('12345');
  });
});
