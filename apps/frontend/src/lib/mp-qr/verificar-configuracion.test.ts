import { describe, expect, it } from 'vitest';

import {
  resolveMpQrExternalPosId,
  resolveMpQrPos,
  runMpQrVerificacionMpQr,
} from '@/lib/mp-qr/verificar-configuracion';

function jsonResponse(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Adapta mocks `(url) =>` al tipo estándar de `fetch` (RequestInfo | URL). */
function asFetch(fn: (url: string, init?: RequestInit) => Promise<Response>): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    return fn(url, init);
  }) as typeof fetch;
}

describe('runMpQrVerificacionMpQr', () => {
  it('check 1: token inválido → solo token falla, resto omitido', async () => {
    const fetchImpl = asFetch(async (url) => {
      if (url.includes('/users/me')) return jsonResponse({ message: 'bad' }, 401);
      return jsonResponse({}, 500);
    });
    const r = await runMpQrVerificacionMpQr(
      { access_token: 't', user_id: '1', external_pos_id: 'X' },
      { fetchImpl },
    );
    expect(r.ok).toBe(false);
    expect(r.checks.token_valido.ok).toBe(false);
    expect(r.checks.token_valido.mensaje).toMatch(/inválido|401|Token/i);
    expect(r.checks.user_id_coincide.mensaje).toMatch(/No ejecutado/i);
    expect(r.checks.caja_existe.mensaje).toMatch(/No ejecutado/i);
    expect(r.checks.cobro_de_prueba.mensaje).toMatch(/No ejecutado/i);
  });

  it('check 2: user_id no coincide', async () => {
    const fetchImpl = asFetch(async (url) => {
      if (url.includes('/users/me')) return jsonResponse({ id: 999, nickname: 'x' });
      return jsonResponse({}, 500);
    });
    const r = await runMpQrVerificacionMpQr(
      { access_token: 't', user_id: '1', external_pos_id: 'CAJA' },
      { fetchImpl },
    );
    expect(r.ok).toBe(false);
    expect(r.checks.token_valido.ok).toBe(true);
    expect(r.checks.user_id_coincide.ok).toBe(false);
    expect(r.checks.user_id_coincide.mensaje).toContain('999');
    expect(r.checks.caja_existe.mensaje).toMatch(/No ejecutado/i);
  });

  it('check 3: lista de cajas vacía', async () => {
    const fetchImpl = asFetch(async (url) => {
      if (url.includes('/users/me')) return jsonResponse({ id: 1, nickname: 'x' });
      if (new URL(url).pathname === '/pos') return jsonResponse({ results: [] });
      return jsonResponse({}, 500);
    });
    const r = await runMpQrVerificacionMpQr(
      { access_token: 't', user_id: '1', external_pos_id: 'CAJA' },
      { fetchImpl },
    );
    expect(r.ok).toBe(false);
    expect(r.checks.caja_existe.ok).toBe(false);
    expect(r.checks.caja_existe.mensaje).toMatch(/ninguna caja/i);
    expect(r.checks.cobro_de_prueba.mensaje).toMatch(/No ejecutado/i);
  });

  it('check 3: no matchea external_pos_id', async () => {
    const fetchImpl = asFetch(async (url) => {
      if (url.includes('/users/me')) return jsonResponse({ id: 1, nickname: 'x' });
      if (new URL(url).pathname === '/pos')
        return jsonResponse({
          results: [{ id: 10, name: 'A', external_id: 'OTHER', fixed_amount: true }],
        });
      return jsonResponse({}, 500);
    });
    const r = await runMpQrVerificacionMpQr(
      { access_token: 't', user_id: '1', external_pos_id: 'CAJA01' },
      { fetchImpl },
    );
    expect(r.ok).toBe(false);
    expect(r.checks.caja_existe.ok).toBe(false);
    expect(r.checks.caja_existe.mensaje).toContain('CAJA01');
    expect(r.checks.caja_existe.sugerencia).toBeTruthy();
  });

  it('check 3: caja sin fixed_amount', async () => {
    const fetchImpl = asFetch(async (url) => {
      if (url.includes('/users/me')) return jsonResponse({ id: 1, nickname: 'x' });
      if (new URL(url).pathname === '/pos')
        return jsonResponse({
          results: [{ id: 10, name: 'Caja', external_id: 'CAJA01', fixed_amount: false }],
        });
      return jsonResponse({}, 500);
    });
    const r = await runMpQrVerificacionMpQr(
      { access_token: 't', user_id: '1', external_pos_id: 'CAJA01' },
      { fetchImpl },
    );
    expect(r.ok).toBe(false);
    expect(r.checks.caja_existe.ok).toBe(false);
    expect(r.checks.caja_existe.mensaje).toMatch(/monto cerrado/i);
    expect(r.checks.caja_existe.caja_info?.external_id).toBe('CAJA01');
  });

  it('check 3: match por id numérico sin external_id', async () => {
    const fetchImpl = asFetch(async (url, init) => {
      if (url.includes('/users/me')) return jsonResponse({ id: 1, nickname: 'x' });
      if (new URL(url).pathname === '/pos')
        return jsonResponse({
          results: [{ id: 130896283, name: 'QR', external_id: null, fixed_amount: true }],
        });
      if (url.includes('/instore/') && init?.method === 'PUT') return jsonResponse({ in_store_order_id: 'x', qr: 'y' });
      if (url.includes('/instore/') && init?.method === 'DELETE') return new Response('', { status: 200 });
      return jsonResponse({}, 500);
    });
    const r = await runMpQrVerificacionMpQr(
      { access_token: 't', user_id: '1', external_pos_id: '130896283' },
      { fetchImpl },
    );
    expect(r.ok).toBe(true);
    expect(r.checks.caja_existe.ok).toBe(true);
    expect(r.checks.cobro_de_prueba.ok).toBe(true);
  });

  it('camino feliz: 4 checks OK', async () => {
    const fetchImpl = asFetch(async (url, init) => {
      if (url.includes('/users/me')) return jsonResponse({ id: 171, nickname: 'shop' });
      if (new URL(url).pathname === '/pos')
        return jsonResponse({
          results: [{ id: 10, name: 'Mostrador', external_id: 'CAJA01', fixed_amount: true }],
        });
      if (url.includes('/instore/') && init?.method === 'PUT') return jsonResponse({ in_store_order_id: 'ord', qr: 'z' });
      if (url.includes('/instore/') && init?.method === 'DELETE') return new Response('', { status: 200 });
      return jsonResponse({}, 500);
    });
    const r = await runMpQrVerificacionMpQr(
      { access_token: 'tok', user_id: '171', external_pos_id: 'CAJA01' },
      { fetchImpl },
    );
    expect(r.ok).toBe(true);
    expect(r.checks.token_valido.ok).toBe(true);
    expect(r.checks.user_id_coincide.ok).toBe(true);
    expect(r.checks.caja_existe.ok).toBe(true);
    expect(r.checks.cobro_de_prueba.ok).toBe(true);
  });

  it('check 4: usa endpoint v2 con external_store_id resuelto desde store_id', async () => {
    const urls: string[] = [];
    const fetchImpl = asFetch(async (url, init) => {
      urls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.includes('/users/me')) return jsonResponse({ id: 430, nickname: 'shop' });
      if (new URL(url).pathname === '/pos')
        return jsonResponse({
          results: [
            { id: 10, name: 'Mostrador', external_id: 'CAJA01', store_id: '30714280', fixed_amount: true },
          ],
        });
      if (url.endsWith('/stores/30714280')) return jsonResponse({ id: 30714280, external_id: 'SUC01' });
      if (url.includes('/instore/') && init?.method === 'PUT') return new Response(null, { status: 204 });
      if (url.includes('/instore/') && init?.method === 'DELETE') return new Response('', { status: 200 });
      return jsonResponse({}, 500);
    });
    const r = await runMpQrVerificacionMpQr(
      { access_token: 'tok', user_id: '430', external_pos_id: 'CAJA01' },
      { fetchImpl },
    );
    expect(r.ok).toBe(true);
    expect(urls.some((url) => url.startsWith('PUT ') && url.includes('/stores/SUC01/pos/CAJA01/orders'))).toBe(true);
    expect(
      urls.some((url) => url.startsWith('DELETE ') && url.includes('/collectors/430/pos/CAJA01/orders')),
    ).toBe(true);
    expect(urls.some((url) => url.startsWith('DELETE ') && url.includes('/stores/SUC01/'))).toBe(false);
  });

  it('check 4: MP rechaza el PUT', async () => {
    const fetchImpl = asFetch(async (url, init) => {
      if (url.includes('/users/me')) return jsonResponse({ id: 1, nickname: 'x' });
      if (new URL(url).pathname === '/pos')
        return jsonResponse({
          results: [{ id: 10, name: 'C', external_id: 'CAJA01', fixed_amount: true }],
        });
      if (url.includes('/instore/') && init?.method === 'PUT')
        return jsonResponse({ message: 'pos_obtainment_error', error: 'not_found' }, 404);
      return jsonResponse({}, 500);
    });
    const r = await runMpQrVerificacionMpQr(
      { access_token: 't', user_id: '1', external_pos_id: 'CAJA01' },
      { fetchImpl },
    );
    expect(r.ok).toBe(false);
    expect(r.checks.cobro_de_prueba.ok).toBe(false);
    expect(r.checks.cobro_de_prueba.mensaje).toMatch(/404|pos_obtainment|rechazó/i);
  });

  it('check 4: PUT OK pero DELETE falla → ok global true y mensaje de advertencia', async () => {
    const fetchImpl = asFetch(async (url, init) => {
      if (url.includes('/users/me')) return jsonResponse({ id: 1, nickname: 'x' });
      if (new URL(url).pathname === '/pos')
        return jsonResponse({
          results: [{ id: 10, name: 'C', external_id: 'CAJA01', fixed_amount: true }],
        });
      if (url.includes('/instore/') && init?.method === 'PUT') return jsonResponse({ in_store_order_id: 'o', qr: 'q' });
      if (url.includes('/instore/') && init?.method === 'DELETE') return new Response('', { status: 409 });
      return jsonResponse({}, 500);
    });
    const r = await runMpQrVerificacionMpQr(
      { access_token: 't', user_id: '1', external_pos_id: 'CAJA01' },
      { fetchImpl },
    );
    expect(r.ok).toBe(true);
    expect(r.checks.cobro_de_prueba.ok).toBe(true);
    expect(r.checks.cobro_de_prueba.mensaje).toMatch(/no se pudo cancelar|manualmente/i);
  });

  it('check 3: error al listar pos', async () => {
    const fetchImpl = asFetch(async (url) => {
      if (url.includes('/users/me')) return jsonResponse({ id: 1, nickname: 'x' });
      if (new URL(url).pathname === '/pos') return jsonResponse({ message: 'forbidden' }, 403);
      return jsonResponse({}, 500);
    });
    const r = await runMpQrVerificacionMpQr(
      { access_token: 't', user_id: '1', external_pos_id: 'X' },
      { fetchImpl },
    );
    expect(r.checks.caja_existe.ok).toBe(false);
    expect(r.checks.caja_existe.mensaje).toMatch(/403|permisos/i);
  });
});

describe('resolveMpQrExternalPosId', () => {
  it('no consulta /pos si ya parece external_id', async () => {
    let calls = 0;
    const fetchImpl = asFetch(async () => {
      calls += 1;
      return jsonResponse({}, 500);
    });
    const r = await resolveMpQrExternalPosId(
      { access_token: 'tok', user_id: '1', external_pos_id: 'CAJA01' },
      { fetchImpl },
    );
    expect(r.external_pos_id).toBe('CAJA01');
    expect(r.resolved_from_internal_id).toBe(false);
    expect(calls).toBe(0);
  });

  it('si recibe id interno numerico, lo resuelve al external_id de la caja', async () => {
    const fetchImpl = asFetch(async (url) => {
      if (new URL(url).pathname === '/pos') {
        return jsonResponse({
          results: [{ id: 130896283, name: 'QR', external_id: 'CAJA01', fixed_amount: true }],
        });
      }
      return jsonResponse({}, 500);
    });
    const r = await resolveMpQrExternalPosId(
      { access_token: 'tok', user_id: '1', external_pos_id: '130896283' },
      { fetchImpl },
    );
    expect(r.external_pos_id).toBe('CAJA01');
    expect(r.resolved_from_internal_id).toBe(true);
  });
});

describe('resolveMpQrPos', () => {
  it('resuelve external_store_id desde store_id de la caja', async () => {
    const fetchImpl = asFetch(async (url) => {
      if (new URL(url).pathname === '/pos') {
        return jsonResponse({
          results: [{ id: 10, name: 'QR', external_id: 'CAJA01', store_id: '30714280', fixed_amount: true }],
        });
      }
      if (url.endsWith('/stores/30714280')) return jsonResponse({ id: 30714280, external_id: 'SUC01' });
      return jsonResponse({}, 500);
    });
    const r = await resolveMpQrPos(
      { access_token: 'tok', user_id: '430', external_pos_id: 'CAJA01' },
      { fetchImpl },
    );
    expect(r.external_pos_id).toBe('CAJA01');
    expect(r.external_store_id).toBe('SUC01');
  });
});
