import {
  comprobanteEsVentaMpQrCompleta,
  comprobanteTienePagoMpQr,
} from './mp-qr-venta.util';
import { EstadoComprobante } from '../../facturacion/enums/estado-comprobante.enum';
import { TipoComprobante } from '../../facturacion/enums/tipo-comprobante.enum';

describe('mp-qr-venta.util', () => {
  it('comprobanteEsVentaMpQrCompleta exige emitido + payment + cae fiscal', () => {
    expect(
      comprobanteEsVentaMpQrCompleta({
        estado: EstadoComprobante.emitido,
        tipo: TipoComprobante.factura_b,
        cae: '12345678901234',
        mpQrPaymentId: '99',
      }),
    ).toBe(true);

    expect(
      comprobanteEsVentaMpQrCompleta({
        estado: EstadoComprobante.emitido,
        tipo: TipoComprobante.factura_b,
        cae: null,
        mpQrPaymentId: '99',
      }),
    ).toBe(false);
  });

  it('comprobanteTienePagoMpQr', () => {
    expect(comprobanteTienePagoMpQr({ mpQrPaymentId: '1' })).toBe(true);
    expect(comprobanteTienePagoMpQr({ mpQrPaymentId: null })).toBe(false);
  });
});
