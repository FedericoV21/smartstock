import { describe, expect, it } from 'vitest';

import {
  filasImportDesdeRawBorrador,
  filasIncluidasDesdePayloadBorrador,
} from '@/lib/importar/borrador-import-server';
import type { ImportacionBorradorPayloadV1 } from '@/lib/importar/borradores';

describe('borrador-import-server', () => {
  const mapeo = [
    {
      headerOriginal: 'Codigo',
      campoDetectado: 'codigo' as const,
      confianza: 'exacta' as const,
      ignorar: false,
    },
    {
      headerOriginal: 'Nombre',
      campoDetectado: 'nombre' as const,
      confianza: 'exacta' as const,
      ignorar: false,
    },
    {
      headerOriginal: 'Costo',
      campoDetectado: 'precio_costo' as const,
      confianza: 'exacta' as const,
      ignorar: false,
    },
  ];

  it('convierte filas raw del borrador a payload de importación', () => {
    const filas = filasImportDesdeRawBorrador(
      [
        { Codigo: 'A1', Nombre: 'Producto uno', Costo: 100 },
        { Codigo: 'A2', Nombre: 'Producto dos', Costo: 200 },
      ],
      mapeo,
    );
    expect(filas).toHaveLength(2);
    expect(filas[0]?.codigo).toBe('A1');
    expect(filas[0]?.nombre).toBe('Producto uno');
    expect(filas[0]?.precio_costo).toBe(100);
    expect(typeof filas[0]?.fila_original).toBe('number');
  });

  it('filtra por filas_incluidas guardadas en el payload del borrador', () => {
    const payload = {
      version: 1,
      flujo: 'importar',
      paso: 'preview',
      origenImportacion: 'importacion_excel',
      archivo: { nombreArchivo: 'x.csv', headers: [], totalFilas: 2 },
      mapeo,
      preview: {
        importConfirm: {
          filas_incluidas: [2],
        },
      },
    } satisfies ImportacionBorradorPayloadV1;

    const incluidas = filasIncluidasDesdePayloadBorrador(payload);
    const filas = filasImportDesdeRawBorrador(
      [
        { Codigo: 'A1', Nombre: 'Uno', Costo: 10 },
        { Codigo: 'A2', Nombre: 'Dos', Costo: 20 },
      ],
      mapeo,
      incluidas,
    );
    expect(filas).toHaveLength(1);
    expect(filas[0]?.fila_original).toBe(2);
    expect(filas[0]?.codigo).toBe('A2');
  });
});
