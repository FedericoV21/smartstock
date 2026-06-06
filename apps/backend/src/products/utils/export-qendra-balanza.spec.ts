import {
  filasQendraBalanzaACsv,
  formatPrecioQendra,
  pluParaExportQendra,
  productoAFilaQendraBalanza,
  productoEsExportableQendraBalanza,
  tipoVentaQendraProducto,
  vencimientoQendraExport,
} from './export-qendra-balanza';

describe('export-qendra-balanza utils', () => {
  it('formatea precio con coma decimal', () => {
    expect(formatPrecioQendra(12.5)).toBe('12,50');
    expect(formatPrecioQendra(7500)).toBe('7500,00');
  });

  it('exporta PLU sin ceros a la izquierda', () => {
    expect(pluParaExportQendra('00005')).toBe('5');
    expect(pluParaExportQendra('00101')).toBe('101');
  });

  it('filtra productos exportables', () => {
    expect(
      productoEsExportableQendraBalanza({ plu: '4012', esPesable: true, unidad: 'kg' }),
    ).toBe(true);
    expect(
      productoEsExportableQendraBalanza({ plu: '10', esPesable: false, unidad: 'unidad' }),
    ).toBe(true);
    expect(
      productoEsExportableQendraBalanza({ plu: null, esPesable: true, unidad: 'kg' }),
    ).toBe(false);
    expect(
      productoEsExportableQendraBalanza({ plu: '10', esPesable: false, unidad: 'kg' }),
    ).toBe(false);
  });

  it('arma fila pesable tipo p', () => {
    const fila = productoAFilaQendraBalanza({
      plu: '252',
      nombre: 'aceitunas con carozo',
      precioVenta: 20000,
      sector: 'FIAMBRE',
      esPesable: true,
      unidad: 'kg',
    });
    expect(fila).toEqual([
      'FIAMBRE',
      '252',
      'aceitunas con carozo',
      '252',
      '20000,00',
      '0,00',
      'p',
      '0',
      '',
    ]);
  });

  it('arma fila unidad tipo u', () => {
    expect(tipoVentaQendraProducto(false, 'unidad')).toBe('u');
  });

  it('calcula vencimiento en d├¡as', () => {
    expect(vencimientoQendraExport(null, '2026-06-05')).toBe('0');
    expect(vencimientoQendraExport('2026-06-15', '2026-06-05')).toBe('10');
  });

  it('genera CSV con BOM y CRLF', () => {
    const csv = filasQendraBalanzaACsv([['A', '1']]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('A;1');
  });
});
