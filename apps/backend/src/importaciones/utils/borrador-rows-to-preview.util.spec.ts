import { draftRowsToImportPreviewRows } from './borrador-rows-to-preview.util';

const mapeo = [
  { headerOriginal: 'Codigo', campoDetectado: 'codigo', ignorar: false },
  { headerOriginal: 'Nombre', campoDetectado: 'nombre', ignorar: false },
  { headerOriginal: 'Costo', campoDetectado: 'precio_costo', ignorar: false },
];

describe('borrador-rows-to-preview.util', () => {
  it('maps raw rows using column mapping', () => {
    const rows = draftRowsToImportPreviewRows(
      [{ Codigo: 'A1', Nombre: 'Yerba', Costo: '1.234,50' }],
      mapeo,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].codigo).toBe('A1');
    expect(rows[0].nombre).toBe('Yerba');
    expect(rows[0].precioCosto).toBe(1234.5);
  });

  it('filters by included row numbers', () => {
    const rows = draftRowsToImportPreviewRows(
      [
        { Codigo: 'A1', Nombre: 'Uno', Costo: '10' },
        { Codigo: 'A2', Nombre: 'Dos', Costo: '20' },
      ],
      mapeo,
      new Set([2]),
      0,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].codigo).toBe('A2');
  });

  it('skips rows without nombre', () => {
    const rows = draftRowsToImportPreviewRows([{ Codigo: 'A1', Nombre: '', Costo: '10' }], mapeo);
    expect(rows).toHaveLength(0);
  });
});
