import { comprobanteEsVentaMpPointCompleta, comprobanteTienePagoMpPoint } from './mp-point-venta.util';

describe('mp-point-venta.util', () => {
  it('completa cuando emitido + payment + cae fiscal', () => {
    expect(
      comprobanteEsVentaMpPointCompleta({
        estado: 'emitido',
        tipo: 'factura_b',
        cae: '12345678901234',
        mpPointPaymentId: '99',
      }),
    ).toBe(true);
  });

  it('incompleta fiscal sin cae', () => {
    expect(
      comprobanteEsVentaMpPointCompleta({
        estado: 'emitido',
        tipo: 'factura_b',
        cae: null,
        mpPointPaymentId: 1,
      }),
    ).toBe(false);
  });

  it('tiene pago mp con id positivo', () => {
    expect(comprobanteTienePagoMpPoint({ mpPointPaymentId: '12345' })).toBe(true);
    expect(comprobanteTienePagoMpPoint({ mpPointPaymentId: null })).toBe(false);
  });
});
