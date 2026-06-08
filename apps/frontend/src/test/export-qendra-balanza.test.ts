import { describe, expect, it } from 'vitest';

import { parseBarcode } from '@/lib/pos/barcode-parser';
import {
  codigoBarrasCatalogoPesable,
  filasQendraBalanzaACsv,
  formatPrecioQendra,
  pluParaExportQendra,
  precioLista2Qendra,
  productoAFilaQendraBalanza,
  productoEsExportableQendraBalanza,
  tipoVentaQendraProducto,
  truncarDescripcionBalanza,
  vencimientoQendraExport,
} from '@/lib/productos/export-qendra-balanza';

describe('export-qendra-balanza', () => {
  it('formatea precio con coma decimal', () => {
    expect(formatPrecioQendra(12.5)).toBe('12,50');
    expect(formatPrecioQendra(4590)).toBe('4590,00');
    expect(formatPrecioQendra(7500)).toBe('7500,00');
  });

  it('exporta PLU sin ceros a la izquierda', () => {
    expect(pluParaExportQendra('00101')).toBe('101');
    expect(pluParaExportQendra('00001')).toBe('1');
    expect(pluParaExportQendra('00005')).toBe('5');
    expect(pluParaExportQendra('1001')).toBe('1001');
  });

  it('genera EAN-13 de catálogo 20+PLU+00000 compatible con el parser POS', () => {
    const ean = codigoBarrasCatalogoPesable('123', null);
    expect(ean).toHaveLength(13);
    expect(ean.startsWith('20')).toBe(true);
    const parsed = parseBarcode(ean);
    expect(parsed.tipo).toBe('balanza_peso');
    expect(parsed.codigoLookup).toBe('00123');
    expect(parsed.pesoKg).toBe(0);
  });

  it('reutiliza codigo_barras si ya es EAN-13 de balanza válido', () => {
    const existente = '2000123004501';
    expect(codigoBarrasCatalogoPesable('123', existente)).toBe(existente);
  });

  it('arma fila Systel Max para pesable (tipo p)', () => {
    const fila = productoAFilaQendraBalanza({
      plu: '252',
      nombre: 'aceitunas con carozo',
      precio_venta: 20000,
      sector: 'FIAMBRE',
      es_pesable: true,
      unidad: 'kg',
      fecha_vencimiento: null,
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

  it('arma fila Systel Max para unidad (tipo u)', () => {
    expect(tipoVentaQendraProducto(false, 'unidad')).toBe('u');
    const fila = productoAFilaQendraBalanza({
      plu: '274',
      nombre: 'combo 1',
      precio_venta: 2500,
      sector: 'FIAMBRE',
      es_pesable: false,
      unidad: 'unidad',
    });
    expect(fila).toEqual([
      'FIAMBRE',
      '274',
      'combo 1',
      '274',
      '2500,00',
      '0,00',
      'u',
      '0',
      '',
    ]);
  });

  it('PLU por unidad exporta u aunque es_pesable venga mal', () => {
    expect(tipoVentaQendraProducto(undefined, 'unidad')).toBe('u');
    expect(tipoVentaQendraProducto(true, 'unidad')).toBe('u');
    const fila = productoAFilaQendraBalanza({
      plu: '00002',
      nombre: 'Caja de pollo',
      precio_venta: 3500,
      sector: 'AVICOLA',
      unidad: 'unidad',
    });
    expect(fila[6]).toBe('u');
    expect(fila[1]).toBe('2');
  });

  it('pesable en kg exporta p', () => {
    expect(tipoVentaQendraProducto(true, 'kg')).toBe('p');
  });

  it('aplica descuento en Precio Lista 2', () => {
    expect(precioLista2Qendra(2500, 10)).toBe('2250,00');
    expect(precioLista2Qendra(2500, null)).toBe('0,00');
    const fila = productoAFilaQendraBalanza({
      plu: '274',
      nombre: 'combo 1',
      precio_venta: 2500,
      sector: 'FIAMBRE',
      unidad: 'unidad',
      descuento_pct: 20,
    });
    expect(fila[5]).toBe('2000,00');
    expect(fila[4]).toBe('2500,00');
  });

  it('vencimiento 0 sin fecha; días si hay fecha futura', () => {
    expect(vencimientoQendraExport(null)).toBe('0');
    expect(vencimientoQendraExport('', '2026-06-02')).toBe('0');
    expect(vencimientoQendraExport('2026-06-10', '2026-06-02')).toBe('8');
  });

  it('solo exporta no pesables con unidad de stock unidad y PLU', () => {
    expect(
      productoEsExportableQendraBalanza({
        plu: '1',
        es_pesable: false,
        unidad: 'unidad',
      }),
    ).toBe(true);
    expect(
      productoEsExportableQendraBalanza({
        plu: '1',
        es_pesable: false,
        unidad: 'kg',
      }),
    ).toBe(false);
    expect(
      productoEsExportableQendraBalanza({
        plu: null,
        es_pesable: true,
        unidad: 'kg',
      }),
    ).toBe(false);
  });

  it('trunca descripciones largas', () => {
    expect(truncarDescripcionBalanza('a'.repeat(50)).length).toBe(40);
  });

  it('genera CSV UTF-8 sin encabezados con ejemplos Systel', () => {
    const csv = filasQendraBalanzaACsv([
      productoAFilaQendraBalanza({
        plu: '274',
        nombre: 'combo 1',
        precio_venta: 2500,
        sector: 'FIAMBRE',
        unidad: 'unidad',
      }),
      productoAFilaQendraBalanza({
        plu: '252',
        nombre: 'aceitunas con carozo',
        precio_venta: 20000,
        sector: 'FIAMBRE',
        es_pesable: true,
        unidad: 'kg',
      }),
    ]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).not.toContain('Sección;');
    expect(csv).toContain('FIAMBRE;274;combo 1;274;2500,00;0,00;u;0;');
    expect(csv).toContain('FIAMBRE;252;aceitunas con carozo;252;20000,00;0,00;p;0;');
  });
});
