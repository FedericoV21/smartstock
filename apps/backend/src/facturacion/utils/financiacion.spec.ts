import {
  aplicarFinanciacion,
  aplicarFinanciacionMixto,
  validarDetalleMixto,
} from './financiacion';

describe('financiacion', () => {
  const base = { subtotal: 100, ivaPorcentaje: 21, ivaMonto: 21, total: 121 };

  it('aplica recargo sin alterar neto/IVA', () => {
    const r = aplicarFinanciacion(base, {
      medioNombre: 'Tarjeta',
      cuotas: 3,
      recargo_porcentaje: 10,
    });
    expect(r.importes.subtotal).toBe(100);
    expect(r.importes.ivaMonto).toBe(21);
    expect(r.importes.total).toBe(133.1);
    expect(r.financiacionMonto).toBe(12.1);
    expect(r.impTribArca).toBe(12.1);
  });

  it('aplica descuento escalando neto e IVA', () => {
    const r = aplicarFinanciacion(base, {
      medioNombre: 'Efectivo',
      cuotas: 1,
      recargo_porcentaje: -10,
    });
    expect(r.importes.total).toBe(108.9);
    expect(r.importes.subtotal).toBeLessThan(100);
    expect(r.impTribArca).toBe(0);
  });

  it('valida pago mixto', () => {
    const bad = validarDetalleMixto({ efectivo: 50 }, 121);
    expect(bad.ok).toBe(false);

    const ok = validarDetalleMixto(
      { efectivo: 60, debito: 61, credito: 0, transferencia: 0, cuenta_corriente: 0 },
      121,
    );
    expect(ok.ok).toBe(true);
  });

  it('aplica financiacion mixto con recargo en efectivo', () => {
    const r = aplicarFinanciacionMixto(
      base,
      { efectivo: 121, debito: 0, credito: 0, transferencia: 0, cuenta_corriente: 0 },
      { efectivo: 10, debito: 0, credito: 0, transferencia: 0, mixto: 0 },
    );
    expect(r.esPagoMixto).toBe(true);
    expect(r.importes.total).toBeGreaterThan(121);
    expect(r.financiacionDescripcion).toContain('Pago mixto');
  });
});
