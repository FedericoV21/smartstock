import {
  chunkDraftRows,
  metadataFromDraftPayload,
  validateDraftPayload,
} from './import-draft-payload.util';

const basePayload = {
  version: 1,
  flujo: 'importar',
  paso: 'mapeo',
  origenImportacion: 'importacion_excel',
  archivo: { nombreArchivo: 'lista.xlsx', headers: ['Codigo', 'Nombre'], totalFilas: 2 },
  mapeo: [
    { headerOriginal: 'Codigo', campoDetectado: 'codigo', confianza: 'exacta', ignorar: false },
    { headerOriginal: 'Nombre', campoDetectado: 'nombre', confianza: 'exacta', ignorar: false },
  ],
} as const;

describe('import-draft-payload.util', () => {
  it('validates payload v1', () => {
    expect(validateDraftPayload(basePayload).flujo).toBe('importar');
  });

  it('rejects invalid version', () => {
    expect(() => validateDraftPayload({ ...basePayload, version: 2 })).toThrow(
      'Version de borrador invalida',
    );
  });

  it('maps metadata from payload', () => {
    const meta = metadataFromDraftPayload({
      ...basePayload,
      proveedorId: '00000000-0000-4000-8000-000000000099',
    });
    expect(meta.archivoNombre).toBe('lista.xlsx');
    expect(meta.totalFilas).toBe(2);
    expect(meta.proveedorId).toBe('00000000-0000-4000-8000-000000000099');
  });

  it('chunks rows in blocks of 500', () => {
    const filas = Array.from({ length: 1200 }, (_, i) => ({ n: i }));
    const chunks = chunkDraftRows(filas, 500);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(500);
    expect(chunks[2]).toHaveLength(200);
  });
});
