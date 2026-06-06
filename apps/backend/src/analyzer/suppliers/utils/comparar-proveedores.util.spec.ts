import { calcularScoresProveedores, regresionLineal } from './comparar-proveedores.util';

describe('comparar-proveedores.util', () => {
  it('ordena proveedores por score_total desc', () => {
    const scores = calcularScoresProveedores(
      [
        { proveedorId: 'a', productoId: 'p1', precioCosto: 100 },
        { proveedorId: 'b', productoId: 'p1', precioCosto: 80 },
      ],
      new Map([
        ['a', 'Proveedor A'],
        ['b', 'Proveedor B'],
      ]),
      [
        { proveedorId: 'a', variacionPromedioPct: 5 },
        { proveedorId: 'b', variacionPromedioPct: 2 },
      ],
    );
    expect(scores.length).toBe(2);
    expect(scores[0].proveedor_id).toBe('b');
    expect(scores[0].score_total).toBeGreaterThanOrEqual(scores[1].score_total);
  });

  it('regresionLineal predice siguiente valor', () => {
    const { pendiente, prediccion } = regresionLineal([1, 2, 3, 4]);
    expect(pendiente).toBeGreaterThan(0);
    expect(prediccion).toBeGreaterThan(4);
  });
});
