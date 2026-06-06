import {
  fetchMercadoPagoPaymentV1,
  pagoV1AunProcesandose,
  pagoV1FueRechazadoOAnulado,
  pagoV1PermiteEmitirComprobante,
} from './payment-v1.util';

describe('payment-v1.util', () => {
  it('approved permite emitir', () => {
    expect(pagoV1PermiteEmitirComprobante({ id: 1, status: 'approved', statusDetail: null })).toBe(
      true,
    );
  });

  it('rejected no permite emitir', () => {
    expect(pagoV1PermiteEmitirComprobante({ id: 1, status: 'rejected', statusDetail: null })).toBe(
      false,
    );
  });

  it('detecta procesando', () => {
    expect(pagoV1AunProcesandose({ id: 1, status: 'pending', statusDetail: null })).toBe(true);
    expect(pagoV1AunProcesandose({ id: 1, status: 'approved', statusDetail: null })).toBe(false);
  });

  it('detecta rechazado o anulado', () => {
    expect(pagoV1FueRechazadoOAnulado({ id: 1, status: 'cancelled', statusDetail: null })).toBe(
      true,
    );
  });

  describe('fetchMercadoPagoPaymentV1', () => {
    it('parsea pago approved', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: 42, status: 'approved', status_detail: 'accredited' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      const p = await fetchMercadoPagoPaymentV1('tok', 42, { fetchImpl });
      expect(p).toEqual({
        id: 42,
        status: 'approved',
        statusDetail: 'accredited',
      });
    });

    it('retorna null en HTTP error', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(new Response('err', { status: 404 }));
      expect(await fetchMercadoPagoPaymentV1('tok', 1, { fetchImpl })).toBeNull();
    });
  });
});
