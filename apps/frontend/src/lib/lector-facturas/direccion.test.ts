import { describe, expect, it } from 'vitest';

import {
  findProveedorPorNombreSimilar,
  scoreNombreProveedorSimilar,
} from '@/lib/lector-facturas/direccion';

describe('matching de proveedor por nombre en lector de facturas', () => {
  it('encuentra un proveedor existente aunque la razon social venga con sufijo distinto', () => {
    const match = findProveedorPorNombreSimilar(
      [
        { id: 'p1', nombre: 'Distribuidora Norte SRL', cuit: '20111111112' },
        { id: 'p2', nombre: 'Libreria Centro', cuit: '20222222223' },
      ],
      'DISTRIBUIDORA NORTE S.A.',
    );

    expect(match?.id).toBe('p1');
  });

  it('tolera una lectura de IA con CUIT incorrecto si el nombre es casi igual', () => {
    const score = scoreNombreProveedorSimilar(
      'Alimentos del Sur Sociedad Anonima',
      'Alimentos Sur SA',
    );

    expect(score).toBeGreaterThanOrEqual(0.78);
  });

  it('no matchea nombres genericamente parecidos si no alcanzan confianza', () => {
    const match = findProveedorPorNombreSimilar(
      [
        { id: 'p1', nombre: 'Distribuidora San Juan', cuit: null },
        { id: 'p2', nombre: 'Ferreteria Industrial', cuit: null },
      ],
      'Distribuidora San Jose',
    );

    expect(match).toBeNull();
  });

  it('evita elegir automaticamente cuando hay dos candidatos similares', () => {
    const match = findProveedorPorNombreSimilar(
      [
        { id: 'p1', nombre: 'Coca Cola Femsa Norte', cuit: null },
        { id: 'p2', nombre: 'Coca Cola Femsa Sur', cuit: null },
      ],
      'Coca Cola Femsa',
    );

    expect(match).toBeNull();
  });
});
