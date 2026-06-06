import {
  buildFusionarProductoCamposPayload,
  DEFAULT_FUSIONAR_PRODUCTO_CAMPOS,
} from './fusionar-producto-campos.util';

describe('fusionar-producto-campos.util', () => {
  it('devuelve defaults sin input', () => {
    expect(buildFusionarProductoCamposPayload(undefined)).toEqual(DEFAULT_FUSIONAR_PRODUCTO_CAMPOS);
  });

  it('acepta camelCase', () => {
    expect(buildFusionarProductoCamposPayload({ nombre: 'loser', stockMinimo: 'max' })).toMatchObject({
      nombre: 'loser',
      stock_minimo: 'max',
    });
  });

  it('rechaza valor inv├ílido', () => {
    expect(() => buildFusionarProductoCamposPayload({ codigo: 'both' })).toThrow('survivor o loser');
  });
});
