import {
  normalizarTextoBusqueda,
  rankScoreBusquedaProducto,
  sanitizarQueryBusqueda,
} from './normalize-busqueda.util';

describe('normalize-busqueda POS', () => {
  it('normaliza acentos y may├║sculas', () => {
    expect(normalizarTextoBusqueda('  ├ürbol  ')).toBe('arbol');
  });

  it('sanitiza caracteres peligrosos en ILIKE', () => {
    expect(sanitizarQueryBusqueda("foo,bar%baz'")).toBe('foo bar baz');
  });

  it('prioriza c├│digo de barras exacto', () => {
    const row = {
      codigo: 'abc',
      nombre: 'Producto',
      codigoBarras: '7791234567890',
      plu: null,
    };
    const q = '7791234567890';
    const qNorm = normalizarTextoBusqueda(q);
    const scoreBarra = rankScoreBusquedaProducto(row, q, qNorm);
    const scoreNombre = rankScoreBusquedaProducto(
      { ...row, codigoBarras: null },
      'producto',
      'producto',
    );
    expect(scoreBarra).toBeLessThan(scoreNombre);
  });
});
