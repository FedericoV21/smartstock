import { describe, expect, it } from 'vitest';

import { prepareMpQrNexusSetup } from '@/lib/mp-qr/setup';

function jsonResponse(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

function asFetch(fn: (url: string, init?: RequestInit) => Promise<Response>): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    return fn(url, init);
  }) as typeof fetch;
}

describe('prepareMpQrNexusSetup', () => {
  it('asigna SUC01 al local sin external_id y crea la caja QR NEXUS', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = asFetch(async (url, init) => {
      calls.push({ url, init });
      const pathname = new URL(url).pathname;
      if (pathname === '/users/me') return jsonResponse({ id: 430, nickname: 'shop' });
      if (pathname === '/users/430/stores/search') {
        return jsonResponse({ results: [{ id: 10, name: 'Local Centro', external_id: null }] });
      }
      if (pathname === '/users/430/stores/10') return jsonResponse({ id: 10, name: 'Local Centro', external_id: 'SUC01' });
      if (pathname === '/pos' && init?.method === 'GET') return jsonResponse({ results: [] });
      if (pathname === '/pos' && init?.method === 'POST') {
        return jsonResponse({
          id: 99,
          name: 'QR NEXUS',
          external_id: 'SUC01QRNEXUS',
          external_store_id: 'SUC01',
          store_id: '10',
          fixed_amount: true,
        });
      }
      return jsonResponse({ message: `Unexpected ${init?.method ?? 'GET'} ${url}` }, 500);
    });

    const result = await prepareMpQrNexusSetup({ accessToken: 'tok', storeId: '10', options: { fetchImpl } });

    expect(result.account.id).toBe('430');
    expect(result.external_store_id).toBe('SUC01');
    expect(result.external_store_id_assigned).toBe(true);
    expect(result.pos_created).toBe(true);
    expect(result.pos.external_id).toBe('SUC01QRNEXUS');

    const updateStore = calls.find((call) => new URL(call.url).pathname === '/users/430/stores/10');
    expect(updateStore?.init?.method).toBe('PUT');
    expect(JSON.parse(String(updateStore?.init?.body))).toMatchObject({ external_id: 'SUC01' });

    const createPos = calls.find((call) => new URL(call.url).pathname === '/pos' && call.init?.method === 'POST');
    expect(JSON.parse(String(createPos?.init?.body))).toMatchObject({
      name: 'QR NEXUS',
      fixed_amount: true,
      store_id: '10',
      external_store_id: 'SUC01',
      external_id: 'SUC01QRNEXUS',
    });
  });

  it('reutiliza una caja QR NEXUS existente con external_id', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const fetchImpl = asFetch(async (url, init) => {
      calls.push({ url, method: init?.method ?? 'GET' });
      const pathname = new URL(url).pathname;
      if (pathname === '/users/me') return jsonResponse({ id: 430, nickname: 'shop' });
      if (pathname === '/users/430/stores/search') {
        return jsonResponse({ results: [{ id: 10, name: 'Local Centro', external_id: 'SUC01' }] });
      }
      if (pathname === '/pos') {
        return jsonResponse({
          results: [
            {
              id: 99,
              name: 'QR NEXUS',
              external_id: 'SUC01QRNEXUS',
              external_store_id: 'SUC01',
              store_id: '10',
              fixed_amount: true,
            },
          ],
        });
      }
      return jsonResponse({ message: `Unexpected ${init?.method ?? 'GET'} ${url}` }, 500);
    });

    const result = await prepareMpQrNexusSetup({ accessToken: 'tok', storeId: '10', options: { fetchImpl } });

    expect(result.external_store_id_assigned).toBe(false);
    expect(result.pos_created).toBe(false);
    expect(result.pos.external_id).toBe('SUC01QRNEXUS');
    expect(calls.some((call) => new URL(call.url).pathname === '/pos' && call.method === 'POST')).toBe(false);
  });

  it('usa SUC02 si SUC01 ya pertenece a otro local', async () => {
    const fetchImpl = asFetch(async (url, init) => {
      const pathname = new URL(url).pathname;
      if (pathname === '/users/me') return jsonResponse({ id: 430 });
      if (pathname === '/users/430/stores/search') {
        return jsonResponse({
          results: [
            { id: 10, name: 'Local Centro', external_id: null },
            { id: 11, name: 'Local Norte', external_id: 'SUC01' },
          ],
        });
      }
      if (pathname === '/users/430/stores/10') return jsonResponse({ id: 10, name: 'Local Centro', external_id: 'SUC02' });
      if (pathname === '/pos' && init?.method === 'GET') return jsonResponse({ results: [] });
      if (pathname === '/pos' && init?.method === 'POST') {
        return jsonResponse({
          id: 99,
          name: 'QR NEXUS',
          external_id: 'SUC02QRNEXUS',
          external_store_id: 'SUC02',
          store_id: '10',
          fixed_amount: true,
        });
      }
      return jsonResponse({ message: `Unexpected ${init?.method ?? 'GET'} ${url}` }, 500);
    });

    const result = await prepareMpQrNexusSetup({ accessToken: 'tok', storeId: '10', options: { fetchImpl } });

    expect(result.external_store_id).toBe('SUC02');
    expect(result.pos.external_id).toBe('SUC02QRNEXUS');
  });
});
