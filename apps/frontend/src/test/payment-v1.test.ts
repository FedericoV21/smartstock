import { describe, expect, it, vi } from 'vitest';

import {
  fetchMercadoPagoPaymentV1,
  intentPointFinalizoConPagoId,
  MP_V1_API_BASE,
  pagoV1AunProcesandose,
  pagoV1FueRechazadoOAnulado,
  pagoV1PermiteEmitirComprobante,
} from '@/lib/mp-point/payment-v1';

const TOKEN = 'APP_USR-test';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('fetchMercadoPagoPaymentV1', () => {
  it('200 devuelve status en minúsculas y status_detail', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: 155_483_086_323,
        status: 'rejected',
        status_detail: 'cc_rejected_high_risk',
      }),
    );
    const r = await fetchMercadoPagoPaymentV1(TOKEN, 155_483_086_323, { fetchImpl: fetchMock });
    expect(r).toEqual({
      id: 155_483_086_323,
      status: 'rejected',
      status_detail: 'cc_rejected_high_risk',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${MP_V1_API_BASE}/payments/155483086323`,
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: `Bearer ${TOKEN}` }),
      }),
    );
  });

  it('200 approved permite emitir', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ id: 1, status: 'approved', status_detail: 'accredited' }),
    );
    const r = await fetchMercadoPagoPaymentV1(TOKEN, 1, { fetchImpl: fetchMock });
    expect(r).not.toBeNull();
    if (r) {
      expect(pagoV1PermiteEmitirComprobante(r)).toBe(true);
      expect(pagoV1FueRechazadoOAnulado(r)).toBe(false);
    }
  });

  it('4xx/5xx retorna null', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: 'not found' }, 404));
    const r = await fetchMercadoPagoPaymentV1(TOKEN, 999, { fetchImpl: fetchMock });
    expect(r).toBeNull();
  });
});

describe('pagoV1AunProcesandose', () => {
  it('in_process y pending', () => {
    expect(
      pagoV1AunProcesandose({ id: 1, status: 'in_process', status_detail: null }),
    ).toBe(true);
    expect(pagoV1AunProcesandose({ id: 1, status: 'pending', status_detail: null })).toBe(true);
  });
});

describe('intentPointFinalizoConPagoId', () => {
  it('FINISHED con id numérico', () => {
    expect(
      intentPointFinalizoConPagoId({
        state: 'FINISHED',
        payment: { id: 123 },
      }),
    ).toBe(true);
  });
  it('sin payment', () => {
    expect(intentPointFinalizoConPagoId({ state: 'FINISHED' })).toBe(false);
  });
});
