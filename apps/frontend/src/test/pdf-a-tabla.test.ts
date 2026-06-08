import { jsPDF } from 'jspdf';
import { describe, expect, it } from 'vitest';

import { convertirPdfTextoATabla } from '@/lib/importar/pdf-a-tabla';

describe('convertir PDF con texto a tabla', () => {
  it('extrae headers y filas desde columnas posicionadas', async () => {
    const pdf = new jsPDF();
    pdf.setFontSize(10);

    const rows = [
      ['Codigo', 'Nombre', 'Costo'],
      ['A-1', 'Tornillo', '100'],
      ['B-2', 'Tuerca', '50'],
    ];

    rows.forEach((row, i) => {
      const y = 20 + i * 8;
      pdf.text(row[0]!, 15, y);
      pdf.text(row[1]!, 55, y);
      pdf.text(row[2]!, 125, y);
    });

    const bytes = new Uint8Array(pdf.output('arraybuffer'));
    const tabla = await convertirPdfTextoATabla(bytes);

    expect(tabla.headers).toEqual(['Codigo', 'Nombre', 'Costo']);
    expect(tabla.filas).toEqual([
      { Codigo: 'A-1', Nombre: 'Tornillo', Costo: '100' },
      { Codigo: 'B-2', Nombre: 'Tuerca', Costo: '50' },
    ]);
  });

  it('infiere codigo, nombre y costo cuando no hay encabezado explicito', async () => {
    const pdf = new jsPDF();
    pdf.setFontSize(10);

    pdf.text('OVN_100', 15, 30);
    pdf.text('COLA VINILICA 125GR', 55, 31.5);
    pdf.text('$', 125, 31.5);
    pdf.text('923', 145, 31.5);

    pdf.text('OVN_101', 15, 42);
    pdf.text('COLA VINILICA 250GR', 55, 43.5);
    pdf.text('$', 125, 43.5);
    pdf.text('1,335', 145, 43.5);

    const tabla = await convertirPdfTextoATabla(new Uint8Array(pdf.output('arraybuffer')));

    expect(tabla.headers).toEqual(['codigo', 'nombre', 'precio_costo']);
    expect(tabla.filas).toEqual([
      { codigo: 'OVN_100', nombre: 'COLA VINILICA 125GR', precio_costo: '923' },
      { codigo: 'OVN_101', nombre: 'COLA VINILICA 250GR', precio_costo: '1,335' },
    ]);
  });

  it('separa codigo pegado al nombre y conserva tres precios', async () => {
    const pdf = new jsPDF();
    pdf.setFontSize(10);

    pdf.text('ST01452-POXIPOL Met. 10 MIN.', 15, 30);
    pdf.text('21G / 14ML', 75, 30);
    pdf.text('5108.70', 125, 30);
    pdf.text('3174.57', 155, 30);
    pdf.text('3841.23', 185, 30);

    pdf.text('ST01453-POXIPOL Transp. 10 MIN.', 15, 42);
    pdf.text('16G / 14ML', 85, 42);
    pdf.text('5108.70', 125, 42);
    pdf.text('3174.57', 155, 42);
    pdf.text('3841.23', 185, 42);

    const tabla = await convertirPdfTextoATabla(new Uint8Array(pdf.output('arraybuffer')));

    expect(tabla.headers).toEqual([
      'codigo',
      'nombre',
      'precio_venta_publico_iva',
      'precio_costo',
      'precio_comercio_con_iva',
    ]);
    expect(tabla.filas).toEqual([
      {
        codigo: 'ST01452',
        nombre: 'POXIPOL Met. 10 MIN. 21G / 14ML',
        precio_venta_publico_iva: '5108.70',
        precio_costo: '3174.57',
        precio_comercio_con_iva: '3841.23',
      },
      {
        codigo: 'ST01453',
        nombre: 'POXIPOL Transp. 10 MIN. 16G / 14ML',
        precio_venta_publico_iva: '5108.70',
        precio_costo: '3174.57',
        precio_comercio_con_iva: '3841.23',
      },
    ]);
  });

  it('alinea filas por posicion cuando una columna visual viene vacia', async () => {
    const pdf = new jsPDF({ orientation: 'landscape' });
    pdf.setFontSize(7);

    const dibujarHeader = (y: number) => {
      pdf.text('FOTO ILUSTRATIVA', 12, y);
      pdf.text('CATEGORIA', 58, y);
      pdf.text('PRODUCTO', 95, y);
      pdf.text('MARCA', 142, y);
      pdf.text('PRESENTACION', 166, y);
      pdf.text('PRECIO A', 198, y);
      pdf.text('PRECIO B', 238, y);
    };

    dibujarHeader(20);
    pdf.text('liviana', 58, 30);
    pdf.text('cerradura de pasador', 95, 30);
    pdf.text('ACYTRA', 142, 30);
    pdf.text('0.04', 166, 30);
    pdf.text('$ 37.194,82', 198, 30);
    pdf.text('$ 44.633,79', 224, 30);

    dibujarHeader(42);
    pdf.text('pesada', 58, 52);
    pdf.text('cerrojo doble perno', 95, 52);
    pdf.text('BUNKER', 142, 52);
    pdf.text('101', 166, 52);
    pdf.text('$ 51.520,27', 198, 52);
    pdf.text('$ 61.824,32', 224, 52);

    const tabla = await convertirPdfTextoATabla(new Uint8Array(pdf.output('arraybuffer')));

    expect(tabla.headers).toEqual([
      'FOTO ILUSTRATIVA',
      'CATEGORIA',
      'PRODUCTO',
      'MARCA',
      'PRESENTACION',
      'PRECIO A',
      'PRECIO B',
    ]);
    expect(tabla.filas).toEqual([
      {
        'FOTO ILUSTRATIVA': null,
        CATEGORIA: 'liviana',
        PRODUCTO: 'cerradura de pasador',
        MARCA: 'ACYTRA',
        PRESENTACION: '0.04',
        'PRECIO A': '$ 37.194,82',
        'PRECIO B': '$ 44.633,79',
      },
      {
        'FOTO ILUSTRATIVA': null,
        CATEGORIA: 'pesada',
        PRODUCTO: 'cerrojo doble perno',
        MARCA: 'BUNKER',
        PRESENTACION: '101',
        'PRECIO A': '$ 51.520,27',
        'PRECIO B': '$ 61.824,32',
      },
    ]);
  });
});
