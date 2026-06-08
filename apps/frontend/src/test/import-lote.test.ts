import { describe, expect, it } from 'vitest';

import {
  buildResolucionMatchAutomatica,
  extraerNombreProveedorUnico,
  mapeoTieneColumnaProveedor,
  prepararFilasValidasImportLote,
} from '@/lib/importar/import-lote';
import type { MapeoColumna } from '@/lib/normalizador/mapear';
import type { FilaValidada } from '@/lib/normalizador/validar';

function fila(partial: Partial<FilaValidada['datos']> & { filaOriginal?: number }): FilaValidada {
  return {
    filaOriginal: partial.filaOriginal ?? 1,
    datos: partial,
    errores: [],
    valida: true,
  };
}

describe('import-lote', () => {
  it('mapeoTieneColumnaProveedor', () => {
    const mapeo: MapeoColumna[] = [
      {
        headerOriginal: 'Proveedor',
        campoDetectado: 'proveedor',
        confianza: 'exacta',
        ignorar: false,
      },
    ];
    expect(mapeoTieneColumnaProveedor(mapeo)).toBe(true);
    expect(
      mapeoTieneColumnaProveedor([
        { headerOriginal: 'X', campoDetectado: 'nombre', confianza: 'exacta', ignorar: false },
      ]),
    ).toBe(false);
  });

  it('extraerNombreProveedorUnico — un solo nombre', () => {
    const r = extraerNombreProveedorUnico([
      fila({ proveedor: '  Distribuidora Sur  ', nombre: 'A' }),
      fila({ filaOriginal: 2, proveedor: 'Distribuidora Sur', nombre: 'B' }),
    ]);
    expect(r.nombre).toBe('Distribuidora Sur');
    expect(r.error).toBeUndefined();
  });

  it('extraerNombreProveedorUnico — rechaza varios', () => {
    const r = extraerNombreProveedorUnico([
      fila({ proveedor: 'A', nombre: 'x' }),
      fila({ filaOriginal: 2, proveedor: 'B', nombre: 'y' }),
    ]);
    expect(r.nombre).toBeNull();
    expect(r.error).toMatch(/Varios proveedores/);
  });

  it('prepararFilasValidasImportLote unifica duplicados por código', () => {
    const validadas: FilaValidada[] = [
      fila({ filaOriginal: 1, codigo: 'X1', nombre: 'Prod', precio_costo: 10 }),
      fila({ filaOriginal: 2, codigo: 'x1', nombre: 'Prod dup', precio_costo: 20 }),
    ];
    const { filas, omitidas } = prepararFilasValidasImportLote(validadas);
    expect(filas).toHaveLength(1);
    expect(omitidas).toBe(1);
  });

  it('buildResolucionMatchAutomatica elige el primer match', () => {
    const r = buildResolucionMatchAutomatica({
      matches: {
        '3': [
          { id: 'p1', codigo: 'a', nombre: 'n' },
          { id: 'p2', codigo: 'a', nombre: 'n2' },
        ],
      },
      requiere_resolucion: {},
    });
    expect(r['3']).toEqual({ action: 'update', producto_id: 'p1' });
  });
});
