import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import { AFIP_QR_VERIFICADOR_BASE, buildQrArcaUrl } from '@/lib/facturacion/arca/qr';

describe('buildQrArcaUrl', () => {
  it('arma la URL del verificador AFIP con JSON en base64 (esquema pyafipws)', () => {
    const url = buildQrArcaUrl({
      cuitEmisor: '30000000007',
      puntoVenta: 10,
      tipoComprobante: 'factura_c',
      numero: 94,
      importeTotal: 121,
      fechaYmd: '2020-10-13',
      cae: '70417054367476',
      clienteCuitDni: '20000000001',
    });

    expect(url.startsWith(AFIP_QR_VERIFICADOR_BASE)).toBe(true);
    const b64 = url.slice(AFIP_QR_VERIFICADOR_BASE.length);
    const decoded = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as Record<string, unknown>;

    expect(decoded).toEqual({
      ver: 1,
      fecha: '2020-10-13',
      cuit: 30000000007,
      ptoVta: 10,
      tipoCmp: 11,
      nroCmp: 94,
      importe: 121,
      moneda: 'PES',
      ctz: 1,
      tipoDocRec: 80,
      nroDocRec: 20000000001,
      tipoCodAut: 'E',
      codAut: 70417054367476,
    });
  });
});
