import { aplanarRepresentativosVentaPorOrden } from './ventas-representativas.util';

describe('ventas-representativas.util', () => {
  it('consolida ticket y factura de la misma orden', () => {
    const rows = aplanarRepresentativosVentaPorOrden([
      { id: 't1', tipo: 'ticket', numeroOrden: 10 },
      { id: 'f1', tipo: 'factura_b', numeroOrden: 10 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tipo).toBe('factura_b');
  });

  it('conserva comprobantes sin numero_orden por id', () => {
    const rows = aplanarRepresentativosVentaPorOrden([
      { id: 'a', tipo: 'ticket', numeroOrden: null },
      { id: 'b', tipo: 'ticket', numeroOrden: null },
    ]);
    expect(rows).toHaveLength(2);
  });
});
