import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchWsfePost } from './fetch-wsfe-retry';

describe('fetchWsfePost', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  function econnresetError(): TypeError {
    const err = new TypeError('fetch failed');
    const cause = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' as const });
    (err as Error & { cause: unknown }).cause = cause;
    return err;
  }

  it('reintenta ante ECONNRESET y luego responde OK', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let n = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      n++;
      if (n < 2) {
        return Promise.reject(econnresetError());
      }
      return Promise.resolve(new Response('<ok/>', { status: 200 }));
    }) as typeof fetch;

    const p = fetchWsfePost('https://example.com/wsfe', {
      method: 'POST',
      body: '<soap/>',
    });
    await vi.runAllTimersAsync();
    const res = await p;
    expect(res.ok).toBe(true);
    expect(n).toBe(2);
  });

  it('agota intentos y relanza si la red sigue fallando', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    globalThis.fetch = vi.fn().mockImplementation(() => Promise.reject(econnresetError())) as typeof fetch;

    const p = fetchWsfePost(
      'https://example.com/wsfe',
      { method: 'POST' },
      { maxAttempts: 2 },
    );
    const outcome = p.then(
      () => ({ ok: true as const }),
      (e: unknown) => ({ ok: false as const, e }),
    );
    await vi.runAllTimersAsync();
    const result = await outcome;
    expect(result.ok).toBe(false);
    expect((result as { e: unknown }).e).toMatchObject({ name: 'TypeError' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('sigue reintentando ante HTTP 503', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let n = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      n++;
      if (n < 2) {
        return Promise.resolve(new Response('bad gateway', { status: 503 }));
      }
      return Promise.resolve(new Response('<ok/>', { status: 200 }));
    }) as typeof fetch;

    const p = fetchWsfePost('https://example.com/wsfe', { method: 'POST' });
    await vi.runAllTimersAsync();
    const res = await p;
    expect(res.ok).toBe(true);
    expect(n).toBe(2);
  });
});
