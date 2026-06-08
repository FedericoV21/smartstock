import { describe, expect, it } from 'vitest';

import {
  aplicarResolucionDuplicadosPorCodigo,
  agruparDuplicadosPorCodigo,
  filaRecomendadaUnificarMismoCodigo,
} from '@/lib/importar/duplicados-codigo-preview';
import type { FilaValidada } from '@/lib/normalizador/validar';

function filaV(
  filaOriginal: number,
  codigo: string,
  nombre: string,
): FilaValidada {
  return {
    filaOriginal,
    datos: { codigo, nombre, precio_costo: 1 },
    errores: [],
    valida: true,
  };
}

describe('duplicados-codigo-preview', () => {
  it('agrupa por codigo (normalizado) con 2+ filas', () => {
    const v = [filaV(1, 'A', 'x'), filaV(2, 'a', 'y'), filaV(3, 'B', 'z')];
    const g = agruparDuplicadosPorCodigo(v);
    expect(g).toHaveLength(1);
    expect(g[0]!.codigoClave).toBe('a');
    expect(g[0]!.filas).toHaveLength(2);
    expect(g[0]!.puedeSeparar).toBe(true);
  });

  it('unificar elimina otras filas del mismo codigo', () => {
    const v = [filaV(1, 'X', 'n1'), filaV(2, 'X', 'n2')];
    const g = agruparDuplicadosPorCodigo(v);
    const r = {
      [g[0]!.codigoClave]: { mode: 'unificar' as const, filaElegidaFilaOriginal: 2 },
    };
    const out = aplicarResolucionDuplicadosPorCodigo(v, g, r);
    expect(out).toHaveLength(1);
    expect(out[0]!.filaOriginal).toBe(2);
  });

  it('recomendación: prioridad código de barras', () => {
    const v: FilaValidada[] = [
      { filaOriginal: 1, datos: { codigo: 'A', nombre: 'x', precio_costo: 100, stock_actual: 10 }, errores: [], valida: true },
      { filaOriginal: 2, datos: { codigo: 'A', nombre: 'y', precio_costo: 1, stock_actual: 0, codigo_barras: '779' }, errores: [], valida: true },
    ];
    expect(filaRecomendadaUnificarMismoCodigo(v)).toBe(2);
  });

  it('recomendación: sin barras, prioriza stock positivo', () => {
    const v: FilaValidada[] = [
      { filaOriginal: 1, datos: { codigo: 'A', nombre: 'x', precio_costo: 999, stock_actual: 0 }, errores: [], valida: true },
      { filaOriginal: 2, datos: { codigo: 'A', nombre: 'y', precio_costo: 1, stock_actual: 3 }, errores: [], valida: true },
    ];
    expect(filaRecomendadaUnificarMismoCodigo(v)).toBe(2);
  });

  it('recomendación: mismo barras y stock, gana el mayor costo', () => {
    const v: FilaValidada[] = [
      { filaOriginal: 1, datos: { codigo: 'A', nombre: 'x', precio_costo: 10, stock_actual: 1, codigo_barras: '1' }, errores: [], valida: true },
      { filaOriginal: 2, datos: { codigo: 'A', nombre: 'y', precio_costo: 50, stock_actual: 1, codigo_barras: '1' }, errores: [], valida: true },
    ];
    expect(filaRecomendadaUnificarMismoCodigo(v)).toBe(2);
  });

  it('recomendación: empate total, menor número de fila', () => {
    const d = { codigo: 'A', nombre: 'x', precio_costo: 5, stock_actual: 2, codigo_barras: '1' };
    const v: FilaValidada[] = [
      { filaOriginal: 1, datos: { ...d, nombre: 'a' }, errores: [], valida: true },
      { filaOriginal: 3, datos: { ...d, nombre: 'b' }, errores: [], valida: true },
    ];
    expect(filaRecomendadaUnificarMismoCodigo(v)).toBe(1);
  });
});
