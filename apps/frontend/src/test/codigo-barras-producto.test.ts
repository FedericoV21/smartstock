import { describe, expect, it } from 'vitest';

import {
  CODIGO_BARRAS_PRODUCTO_MAX_LEN,
  esCodigoBarrasAsignable,
  esCodigoBarrasTextoImprimible,
} from '@/lib/pos/codigo-barras-producto';

describe('codigo-barras-producto', () => {
  it('acepta EAN numérico 8–14 dígitos', () => {
    expect(esCodigoBarrasAsignable('12345678')).toBe(true);
    expect(esCodigoBarrasAsignable('12345678901234')).toBe(true);
  });

  it('acepta SKU con espacios y símbolos ASCII', () => {
    expect(esCodigoBarrasAsignable('td 11mg')).toBe(true);
    expect(esCodigoBarrasAsignable('tee 1/4 full')).toBe(true);
  });

  it('rechaza cadenas demasiado largas', () => {
    expect(esCodigoBarrasAsignable('a'.repeat(65))).toBe(false);
  });

  it('permite códigos cortos numéricos como texto (Code 128)', () => {
    expect(esCodigoBarrasAsignable('1234567')).toBe(true);
  });

  it('rechaza caracteres no ASCII imprimible', () => {
    expect(esCodigoBarrasAsignable('café')).toBe(false);
  });

  it('rechaza vacío y solo espacios para texto', () => {
    expect(esCodigoBarrasTextoImprimible('')).toBe(false);
    expect(esCodigoBarrasTextoImprimible('   ')).toBe(false);
  });

  it('respeta longitud máxima', () => {
    expect(CODIGO_BARRAS_PRODUCTO_MAX_LEN).toBe(64);
    expect(esCodigoBarrasTextoImprimible('a'.repeat(65))).toBe(false);
    expect(esCodigoBarrasTextoImprimible('a'.repeat(64))).toBe(true);
  });
});
