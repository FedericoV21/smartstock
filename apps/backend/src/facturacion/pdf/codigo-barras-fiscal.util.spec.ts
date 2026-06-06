import { TipoComprobante } from '../enums/tipo-comprobante.enum';
import {
  buildCadenaCodigoBarrasAfip,
  caeVencimientoToAfipYyyymmdd,
  digitoVerificadorModulo10,
  mapTipoComprobanteAfip,
} from './codigo-barras-fiscal.util';

describe('codigo-barras-fiscal.util', () => {
  it('digitoVerificadorModulo10 coincide con ejemplo pyafipws pyi25', () => {
    // Python: "%11s%02d%04d%s%8s" % (20267565393, 2, 4001, cae, 20110529)
    const base = '202675653930240016120303473904220110529';
    expect(digitoVerificadorModulo10(base)).toBe('9');
    expect(buildCadenaCodigoBarrasAfip({
      cuitEmisor: '20267565393',
      tipoCbteAfip: 2,
      puntoVenta: 4001,
      cae: '61203034739042',
      caeVencimiento: '20110529',
    })).toBe(`${base}9`);
  });

  it('caeVencimientoToAfipYyyymmdd acepta YYYY-MM-DD', () => {
    expect(caeVencimientoToAfipYyyymmdd('2026-04-20')).toBe('20260420');
  });

  it('buildCadena con CUIT con guiones', () => {
    const base = '202675653930240016120303473904220110529';
    expect(
      buildCadenaCodigoBarrasAfip({
        cuitEmisor: '20-26756539-3',
        tipoCbteAfip: 2,
        puntoVenta: 4001,
        cae: '61203034739042',
        caeVencimiento: '2011-05-29',
      }),
    ).toBe(`${base}9`);
  });

  it('mapTipoComprobanteAfip factura B', () => {
    expect(mapTipoComprobanteAfip(TipoComprobante.factura_b)).toBe(6);
  });
});
