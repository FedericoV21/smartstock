import { describe, expect, it } from 'vitest';

import { ordenarResultadosBusquedaTransferencia } from '@/lib/listados/transferencia-productos-busqueda';

describe('ordenarResultadosBusquedaTransferencia', () => {
  it('prioriza coincidencia exacta de código', () => {
    const out = ordenarResultadosBusquedaTransferencia(
      [
        { id: '1', codigo: 'ABC-10', nombre: 'Aceite 10W' },
        { id: '2', codigo: 'ZZ-1', nombre: 'Filtro ABC-10 alternativo' },
      ],
      'ABC-10',
    );

    expect(out[0]?.id).toBe('1');
  });

  it('prioriza prefijo de nombre sobre coincidencias parciales', () => {
    const out = ordenarResultadosBusquedaTransferencia(
      [
        { id: '1', codigo: 'X1', nombre: 'Repuesto para tuerca grande' },
        { id: '2', codigo: 'Y1', nombre: 'Tuerca grande galvanizada' },
      ],
      'tuerca',
    );

    expect(out[0]?.id).toBe('2');
  });

  it('normaliza acentos: la consulta sin tilde ordena igual que con tilde esperada sobre nombre', () => {
    const out = ordenarResultadosBusquedaTransferencia(
      [
        { id: '1', codigo: 'Z99', nombre: 'Otro café mezcla' },
        { id: '2', codigo: 'CAF-01', nombre: 'Café en grano premium' },
      ],
      'cafe',
    );

    expect(out[0]?.id).toBe('2');
  });
});

