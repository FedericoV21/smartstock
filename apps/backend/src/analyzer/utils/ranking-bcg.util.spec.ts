import { calcularRankingBCGFromLineas } from './ranking-bcg.util';

describe('calcularRankingBCGFromLineas', () => {
  it('clasifica productos en cuadrantes BCG', () => {
    const lineas = [
      {
        producto_id: 'p1',
        cantidad: 100,
        precio_unitario: 10,
        precio_costo: 5,
        fecha: '2026-06-01',
        tipo: 'factura_b',
      },
      {
        producto_id: 'p2',
        cantidad: 5,
        precio_unitario: 20,
        precio_costo: 4,
        fecha: '2026-06-02',
        tipo: 'factura_b',
      },
    ];
    const productos = [
      { id: 'p1', nombre: 'Alto vol', categoriaId: null },
      { id: 'p2', nombre: 'Alto margen', categoriaId: null },
    ];
    const res = calcularRankingBCGFromLineas(lineas, productos, new Map());
    expect(res.productos).toHaveLength(2);
    expect(res.medianas.margen_mediana_pct).toBeGreaterThan(0);
  });
});
