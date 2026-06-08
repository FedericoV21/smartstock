import { describe, expect, it } from 'vitest';

import { comprobanteEsVentaMpPointCompleta } from '@/lib/mp-point/venta-mp-completa';
import { comprobanteEsVentaMpQrCompleta } from '@/lib/mp-qr/venta-mp-qr-completa';

describe('comprobanteEsVentaMpPointCompleta', () => {
  it('true si emitido y mp_point_payment_id (ticket sin CAE)', () => {
    expect(
      comprobanteEsVentaMpPointCompleta({
        estado: 'emitido',
        tipo: 'ticket',
        mp_point_payment_id: 156159490988,
      }),
    ).toBe(true);
  });

  it('false factura B emitida sin CAE aunque tenga payment id', () => {
    expect(
      comprobanteEsVentaMpPointCompleta({
        estado: 'emitido',
        tipo: 'factura_b',
        cae: null,
        mp_point_payment_id: 156159490988,
      }),
    ).toBe(false);
  });

  it('true factura B emitida con CAE y payment id', () => {
    expect(
      comprobanteEsVentaMpPointCompleta({
        estado: 'emitido',
        tipo: 'factura_b',
        cae: '71234567890123',
        mp_point_payment_id: 156159490988,
      }),
    ).toBe(true);
  });

  it('false sin payment id aunque emitido', () => {
    expect(
      comprobanteEsVentaMpPointCompleta({ estado: 'emitido', tipo: 'ticket', mp_point_payment_id: null }),
    ).toBe(false);
  });
  it('false si pendiente con payment id (estado raro)', () => {
    expect(
      comprobanteEsVentaMpPointCompleta({ estado: 'pendiente_posnet', tipo: 'ticket', mp_point_payment_id: 1 }),
    ).toBe(false);
  });
});

describe('comprobanteEsVentaMpQrCompleta', () => {
  it('true ticket emitido con mp_qr_payment_id sin exigir CAE', () => {
    expect(
      comprobanteEsVentaMpQrCompleta({
        estado: 'emitido',
        tipo: 'ticket',
        mp_qr_payment_id: 123,
      }),
    ).toBe(true);
  });

  it('false factura C emitida sin CAE', () => {
    expect(
      comprobanteEsVentaMpQrCompleta({
        estado: 'emitido',
        tipo: 'factura_c',
        cae: null,
        mp_qr_payment_id: 456,
      }),
    ).toBe(false);
  });

  it('true factura C con CAE y mp_qr_payment_id', () => {
    expect(
      comprobanteEsVentaMpQrCompleta({
        estado: 'emitido',
        tipo: 'factura_c',
        cae: '71234567890123',
        mp_qr_payment_id: 456,
      }),
    ).toBe(true);
  });
});
