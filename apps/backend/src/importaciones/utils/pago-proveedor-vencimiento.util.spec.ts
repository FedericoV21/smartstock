import {
  calcularSaldoPendienteNuevoCargo,
  calcularVencimientoDia,
  proveedorTieneCondicionPagoCargada,
} from './pago-proveedor-vencimiento.util';

describe('pago-proveedor-vencimiento.util', () => {
  it('detects loaded payment condition', () => {
    expect(proveedorTieneCondicionPagoCargada({ condicionPagoDefault: 'contado', plazoPagoDias: null })).toBe(
      true,
    );
    expect(proveedorTieneCondicionPagoCargada({ condicionPagoDefault: 'dias', plazoPagoDias: 30 })).toBe(true);
    expect(proveedorTieneCondicionPagoCargada({ condicionPagoDefault: 'dias', plazoPagoDias: null })).toBe(
      false,
    );
  });

  it('calculates contado vencimiento', () => {
    const res = calcularVencimientoDia({
      estado: 'pendiente_condicion',
      fechaFacturaYmd: '2026-06-01',
      proveedor: { condicionPagoDefault: 'contado', plazoPagoDias: null },
    });
    expect(res.vencimientoDiaYmd).toBe('2026-06-01');
    expect(res.condicion).toBe('contado');
  });

  it('calculates pending balance for new charge', () => {
    expect(calcularSaldoPendienteNuevoCargo(1500, 500)).toBe(500);
    expect(calcularSaldoPendienteNuevoCargo(200, 500)).toBe(200);
  });
});
