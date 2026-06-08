import { describe, expect, it } from 'vitest';

import {
  debePostergarFormateoMonto,
  formatearMontoArgentinoEditable,
  parsearMontoEnteroEditable,
  parsearMontoInputUsuario,
} from '@/lib/ui/monto-argentino';

describe('formatearMontoArgentinoEditable', () => {
  it('agrupa miles y usa coma decimal', () => {
    expect(formatearMontoArgentinoEditable(1234.56, 2)).toBe('1.234,56');
    expect(formatearMontoArgentinoEditable(5200, 2)).toBe('5.200');
    expect(formatearMontoArgentinoEditable(3400000, 0)).toBe('3.400.000');
    expect(formatearMontoArgentinoEditable(0, 2)).toBe('0');
  });

  it('recorta ceros decimales superfluos en la vista', () => {
    expect(formatearMontoArgentinoEditable(10.5, 2)).toBe('10,5');
    expect(formatearMontoArgentinoEditable(10, 2)).toBe('10');
  });

  it('respeta negativos', () => {
    expect(formatearMontoArgentinoEditable(-99.9, 2)).toBe('-99,9');
  });
});

describe('debePostergarFormateoMonto', () => {
  it('detecta separador al final', () => {
    expect(debePostergarFormateoMonto('1.')).toBe(true);
    expect(debePostergarFormateoMonto('1,')).toBe(true);
    expect(debePostergarFormateoMonto('1,5')).toBe(false);
  });
});

describe('parsearMontoInputUsuario', () => {
  it('interpreta miles con punto al seguir escribiendo', () => {
    expect(parsearMontoInputUsuario('1.000')).toBe(1000);
    expect(parsearMontoInputUsuario('1.0000')).toBe(10000);
    expect(parsearMontoInputUsuario('10.000')).toBe(10000);
  });

  it('acepta coma decimal', () => {
    expect(parsearMontoInputUsuario('1.234,56')).toBe(1234.56);
  });
});

describe('parsearMontoEnteroEditable', () => {
  it('ignora separadores de miles al seguir escribiendo', () => {
    expect(parsearMontoEnteroEditable('5.000')).toBe(5000);
    expect(parsearMontoEnteroEditable('5.0000')).toBe(50000);
    expect(parsearMontoEnteroEditable('1.2220')).toBe(12220);
  });

  it('parsea dígitos simples', () => {
    expect(parsearMontoEnteroEditable('1222')).toBe(1222);
    expect(parsearMontoEnteroEditable('')).toBeNull();
  });
});
