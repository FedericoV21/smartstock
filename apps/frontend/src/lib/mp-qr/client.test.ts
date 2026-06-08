import { describe, expect, it } from 'vitest';

import { getMpQrClient, MpQrError } from '@/lib/mp-qr/client';

describe('getMpQrClient', () => {
  it('createOrder 200 devuelve JSON parseado', async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ in_store_order_id: 'abc', qr: 'data' }), { status: 200 });
    const c = getMpQrClient('tok', '123', { fetchImpl });
    const r = await c.createOrder('CAJA1', {
      external_reference: 'x',
      title: 't',
      total_amount: 10,
      items: [
        {
          title: 't',
          unit_price: 10,
          quantity: 1,
          unit_measure: 'unit',
          total_amount: 10,
        },
      ],
    });
    expect(r.in_store_order_id).toBe('abc');
    expect(r.qr).toBe('data');
  });

  it('createOrder 201 vacio no intenta parsear JSON', async () => {
    const fetchImpl = async () => new Response('', { status: 201 });
    const c = getMpQrClient('tok', '123', { fetchImpl });
    const r = await c.createOrder('CAJA1', {
      external_reference: 'x',
      title: 't',
      total_amount: 10,
      items: [
        {
          title: 't',
          unit_price: 10,
          quantity: 1,
          unit_measure: 'unit',
          total_amount: 10,
        },
      ],
    });
    expect(r).toEqual({});
  });

  it('createOrder usa endpoint v2 con stores si recibe externalStoreId', async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: RequestInfo | URL) => {
      urls.push(String(url));
      return new Response(null, { status: 204 });
    };
    const c = getMpQrClient('tok', '430', { fetchImpl });
    await c.createOrder(
      'CAJA01',
      {
        external_reference: 'x',
        title: 't',
        total_amount: 10,
        items: [
          {
            title: 't',
            unit_price: 10,
            quantity: 1,
            unit_measure: 'unit',
            total_amount: 10,
          },
        ],
      },
      { externalStoreId: 'SUC01' },
    );
    expect(urls[0]).toContain('/instore/qr/seller/collectors/430/stores/SUC01/pos/CAJA01/orders');
  });

  it('getOrder usa endpoint instore orders v2', async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: RequestInfo | URL) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ in_store_order_id: 'abc' }), { status: 200 });
    };
    const c = getMpQrClient('tok', '123', { fetchImpl });
    await c.getOrder('CAJA1');
    expect(urls[0]).toContain('/instore/qr/seller/collectors/123/pos/CAJA1/orders');
  });

  it('getOrder ignora externalStoreId porque MP solo documenta GET sin stores', async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: RequestInfo | URL) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ in_store_order_id: 'abc' }), { status: 200 });
    };
    const c = getMpQrClient('tok', '123', { fetchImpl });
    await c.getOrder('CAJA1', { externalStoreId: 'SUC01' });
    expect(urls[0]).toContain('/instore/qr/seller/collectors/123/pos/CAJA1/orders');
    expect(urls[0]).not.toContain('/stores/SUC01/');
  });

  it('createOrder 401 lanza MpQrError', async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ message: 'bad', error: 'unauthorized' }), { status: 401 });
    const c = getMpQrClient('tok', '123', { fetchImpl });
    await expect(
      c.createOrder('CAJA1', {
        external_reference: 'x',
        title: 't',
        total_amount: 1,
        items: [
          {
            title: 't',
            unit_price: 1,
            quantity: 1,
            unit_measure: 'unit',
            total_amount: 1,
          },
        ],
      }),
    ).rejects.toMatchObject({ name: 'MpQrError', status: 401 });
  });

  it('cancelOrder 404 no lanza', async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: RequestInfo | URL) => {
      urls.push(String(url));
      return new Response('', { status: 404 });
    };
    const c = getMpQrClient('tok', '123', { fetchImpl });
    await expect(c.cancelOrder('CAJA1')).resolves.toBeUndefined();
    expect(urls[0]).toContain('/instore/qr/seller/collectors/123/pos/CAJA1/orders');
  });

  it('cancelOrder ignora externalStoreId para evitar DELETE no soportado con stores', async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: RequestInfo | URL) => {
      urls.push(String(url));
      return new Response(null, { status: 204 });
    };
    const c = getMpQrClient('tok', '123', { fetchImpl });
    await expect(c.cancelOrder('CAJA1', { externalStoreId: 'SUC01' })).resolves.toBeUndefined();
    expect(urls[0]).toContain('/instore/qr/seller/collectors/123/pos/CAJA1/orders');
    expect(urls[0]).not.toContain('/stores/SUC01/');
  });

  it('cancelOrder usa fallback mpmobile si el DELETE principal falla', async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: RequestInfo | URL) => {
      urls.push(String(url));
      if (String(url).includes('/mpmobile/instore/qr/')) return new Response(null, { status: 204 });
      return new Response('<!DOCTYPE HTML><html><body>405</body></html>', { status: 405 });
    };
    const c = getMpQrClient('tok', '123', { fetchImpl });
    await expect(c.cancelOrder('CAJA1')).resolves.toBeUndefined();
    expect(urls[0]).toContain('/instore/qr/seller/collectors/123/pos/CAJA1/orders');
    expect(urls[1]).toContain('/mpmobile/instore/qr/123/CAJA1');
  });

  it('cancelOrder cancela por Orders API cuando recibe orderId ORD', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const orderId = 'ORD00001111222233334444555566';
    const fetchImpl = async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ id: orderId, status: 'canceled' }), { status: 200 });
    };
    const c = getMpQrClient('tok', '123', { fetchImpl });
    await expect(c.cancelOrder('CAJA1', { orderId })).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain(`/v1/orders/${orderId}/cancel`);
    expect(calls[0].init?.method).toBe('POST');
    expect(new Headers(calls[0].init?.headers).get('X-Idempotency-Key')).toBeTruthy();
  });

  it('cancelOrder 400 in_store_order_delete_error lanza si tampoco sirve el fallback', async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          code: 'in_store_order_delete_error',
          message: 'An error occurred when deleting the InStoreOrder',
        }),
        { status: 400 },
      );
    const c = getMpQrClient('tok', '123', { fetchImpl });
    await expect(c.cancelOrder('CAJA1')).rejects.toMatchObject({
      name: 'MpQrError',
      code: 'in_store_order_delete_error',
    });
  });

  it('getMerchantOrder parsea pagos', async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          id: 99,
          status: 'closed',
          external_reference: 'uuid-1',
          payments: [
            {
              id: 555,
              status: 'approved',
              status_detail: 'accredited',
              transaction_amount: 12.5,
              payment_method_id: 'visa',
              payment_type_id: 'credit_card',
            },
          ],
          shipments: [],
          total_amount: 12.5,
          paid_amount: 12.5,
          refunded_amount: 0,
        }),
        { status: 200 },
      );
    const c = getMpQrClient('tok', '123', { fetchImpl });
    const mo = await c.getMerchantOrder(99);
    expect(mo.id).toBe(99);
    expect(mo.payments[0]?.id).toBe(555);
    expect(mo.payments[0]?.status).toBe('approved');
  });
});

describe('MpQrError', () => {
  it('expone status y code', () => {
    const e = new MpQrError('m', 'c', 400);
    expect(e).toBeInstanceOf(Error);
    expect(e.status).toBe(400);
    expect(e.code).toBe('c');
  });
});
