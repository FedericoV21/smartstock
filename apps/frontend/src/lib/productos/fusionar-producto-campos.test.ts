import { describe, expect, it } from 'vitest';

import {
  buildFusionarProductoCamposPayload,
  DEFAULT_FUSIONAR_PRODUCTO_CAMPOS,
  type FusionarProductoCamposInput,
} from '@/lib/productos/fusionar-producto-campos';

describe('buildFusionarProductoCamposPayload', () => {
  it('devuelve defaults cuando no hay input', () => {
    expect(buildFusionarProductoCamposPayload(undefined)).toEqual(DEFAULT_FUSIONAR_PRODUCTO_CAMPOS);
    expect(buildFusionarProductoCamposPayload(null)).toEqual(DEFAULT_FUSIONAR_PRODUCTO_CAMPOS);
  });

  it('mezcla parcial y normaliza mayúsculas', () => {
    const out = buildFusionarProductoCamposPayload({
      precio_costo: 'LOSER',
      stock_minimo: 'Max',
      precio_sucursal_override: 'MERGE',
    } as unknown as FusionarProductoCamposInput);
    expect(out.precio_costo).toBe('loser');
    expect(out.stock_minimo).toBe('max');
    expect(out.precio_sucursal_override).toBe('merge');
    expect(out.nombre).toBe('survivor');
  });

  it('rechaza clave desconocida', () => {
    expect(() =>
      buildFusionarProductoCamposPayload({ foo: 'survivor' } as unknown as FusionarProductoCamposInput),
    ).toThrow(/no permitido/);
  });

  it('rechaza valor ilegal para origen', () => {
    expect(() =>
      buildFusionarProductoCamposPayload({ codigo: 'both' } as unknown as FusionarProductoCamposInput),
    ).toThrow(/codigo/);
  });

  it('rechaza stock_minimo ilegal', () => {
    expect(() =>
      buildFusionarProductoCamposPayload({ stock_minimo: 'min' } as unknown as FusionarProductoCamposInput),
    ).toThrow(/stock_minimo/);
  });

  it('rechaza precio_sucursal_override ilegal', () => {
    expect(() =>
      buildFusionarProductoCamposPayload({
        precio_sucursal_override: 'sum',
      } as unknown as FusionarProductoCamposInput),
    ).toThrow(/precio_sucursal_override/);
  });
});
