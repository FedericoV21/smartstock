import { compararTemporalFromData } from './comparar-temporal.util';

describe('comparar-temporal.util', () => {
  it('calcula evoluci├│n con al menos 2 listas', () => {
    const d1 = new Date('2026-01-01');
    const d2 = new Date('2026-02-01');

    const res = compararTemporalFromData(
      'prov-1',
      'Proveedor Demo',
      [
        {
          id: 'l1',
          createdAt: d1,
          nombre: 'Lista enero',
          variacionPromedioPct: '5',
          totalItems: 10,
          itemsConAumento: 8,
        },
        {
          id: 'l2',
          createdAt: d2,
          nombre: 'Lista febrero',
          variacionPromedioPct: '3',
          totalItems: 10,
          itemsConAumento: 6,
        },
      ],
      [
        {
          listaId: 'l1',
          productoId: 'p1',
          precioLista: '100',
          variacionPct: '5',
        },
        {
          listaId: 'l2',
          productoId: 'p1',
          precioLista: '110',
          variacionPct: '10',
        },
      ],
      new Map([['p1', 'Producto A']]),
    );

    expect(res.proveedor_id).toBe('prov-1');
    expect(res.listas).toHaveLength(2);
    expect(res.productos_inflacionarios.length + res.productos_estables.length).toBeGreaterThan(0);
  });

  it('rechaza menos de 2 listas', () => {
    expect(() =>
      compararTemporalFromData('p', 'X', [], [], new Map()),
    ).toThrow('Se necesitan al menos 2 listas');
  });
});
