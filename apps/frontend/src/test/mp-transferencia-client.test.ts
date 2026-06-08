import { afterEach, describe, expect, it, vi } from 'vitest';

import { getMpTransferenciaClient, MP_PAYMENTS_SEARCH_API_URL } from '@/lib/mp-transferencia/client';

describe('mp-transferencia client payments search', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('consulta pagos aprobados con token y rango de fechas', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          paging: { total: 1, limit: 20, offset: 0 },
          results: [{ id: 123, status: 'approved', transaction_amount: 1500 }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = await getMpTransferenciaClient('mp-token').searchPayments({
      status: 'approved',
      limit: 20,
      offset: 0,
      sort: 'date_created',
      criteria: 'desc',
      beginDateIso: '2026-05-26T03:00:00.000Z',
      endDateIso: '2026-05-27T03:00:00.000Z',
    });

    expect(out.results?.[0]?.id).toBe(123);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(`${parsed.origin}${parsed.pathname}`).toBe(MP_PAYMENTS_SEARCH_API_URL);
    expect(parsed.searchParams.get('status')).toBe('approved');
    expect(parsed.searchParams.get('limit')).toBe('20');
    expect(parsed.searchParams.get('sort')).toBe('date_created');
    expect(parsed.searchParams.get('criteria')).toBe('desc');
    expect(parsed.searchParams.get('begin_date')).toBe('2026-05-26T03:00:00.000Z');
    expect(parsed.searchParams.get('end_date')).toBe('2026-05-27T03:00:00.000Z');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer mp-token');
  });
});
