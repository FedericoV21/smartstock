import { ejecutarMatching } from './lista-matching.util';

describe('lista-matching.util', () => {
  const productos = [
    { id: 'p1', codigo: 'ABC-101', nombre: 'Arroz 1kg' },
    { id: 'p2', codigo: 'XYZ', nombre: 'Aceite 900ml' },
  ];

  it('matchea por c├│digo exacto', () => {
    const result = ejecutarMatching(
      [{ id: 'i1', codigoProveedor: 'abc101', nombreProveedor: 'Arroz' }],
      productos,
    );
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].productoId).toBe('p1');
    expect(result.matches[0].metodo).toBe('codigo_exacto');
  });

  it('matchea por nombre normalizado', () => {
    const result = ejecutarMatching(
      [{ id: 'i1', codigoProveedor: null, nombreProveedor: 'Aceite 900ml' }],
      productos,
    );
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].metodo).toBe('nombre_normalizado');
  });
});
