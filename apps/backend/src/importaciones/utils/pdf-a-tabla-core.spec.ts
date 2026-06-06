import { convertirChunksPdfATabla, type PdfTextChunk } from './pdf-a-tabla-core';

function cell(page: number, y: number, x: number, text: string): PdfTextChunk {
  return { page, y, x, text, width: text.length * 4, height: 8 };
}

describe('convertirChunksPdfATabla', () => {
  it('extrae headers y filas desde columnas posicionadas', () => {
    const chunks: PdfTextChunk[] = [
      cell(1, 80, 15, 'Codigo'),
      cell(1, 80, 55, 'Nombre'),
      cell(1, 80, 125, 'Costo'),
      cell(1, 60, 15, 'A-1'),
      cell(1, 60, 55, 'Tornillo'),
      cell(1, 60, 125, '100'),
      cell(1, 40, 15, 'B-2'),
      cell(1, 40, 55, 'Tuerca'),
      cell(1, 40, 125, '50'),
    ];

    const tabla = convertirChunksPdfATabla(chunks);

    expect(tabla.headers).toEqual(['Codigo', 'Nombre', 'Costo']);
    expect(tabla.filas).toEqual([
      { Codigo: 'A-1', Nombre: 'Tornillo', Costo: '100' },
      { Codigo: 'B-2', Nombre: 'Tuerca', Costo: '50' },
    ]);
  });

  it('infiere codigo, nombre y costo cuando no hay encabezado explicito', () => {
    const chunks: PdfTextChunk[] = [
      cell(1, 30, 15, 'OVN_100'),
      cell(1, 31.5, 55, 'COLA VINILICA 125GR'),
      cell(1, 31.5, 125, '$'),
      cell(1, 31.5, 145, '923'),
      cell(1, 42, 15, 'OVN_101'),
      cell(1, 43.5, 55, 'COLA VINILICA 250GR'),
      cell(1, 43.5, 125, '$'),
      cell(1, 43.5, 145, '1,335'),
    ];

    const tabla = convertirChunksPdfATabla(chunks);

    expect(tabla.headers).toEqual(['codigo', 'nombre', 'precio_costo']);
    expect(tabla.filas).toHaveLength(2);
    expect(tabla.filas).toEqual(
      expect.arrayContaining([
        { codigo: 'OVN_100', nombre: 'COLA VINILICA 125GR', precio_costo: '923' },
        { codigo: 'OVN_101', nombre: 'COLA VINILICA 250GR', precio_costo: '1,335' },
      ]),
    );
  });

  it('falla cuando no hay texto seleccionable', () => {
    expect(() => convertirChunksPdfATabla([])).toThrow(/texto seleccionable/i);
  });
});
