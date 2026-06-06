import {
  aporteEfectivoEnComprobante,
  calcularSnapshotDesdeComprobantes,
  esVenta,
} from './cierre-z-calculo.util';

describe('cierre-z-calculo', () => {
  it('suma ventas en efectivo y recargo en medios', () => {
    const snap = calcularSnapshotDesdeComprobantes(
      [
        {
          id: '1',
          total: 1000,
          tipo: 'ticket',
          metodo_pago: 'efectivo',
          metodo_pago_detalle: null,
          caja_id: 'caja-1',
        },
        {
          id: '2',
          total: 500,
          tipo: 'ticket',
          metodo_pago: 'credito',
          metodo_pago_detalle: null,
          caja_id: 'caja-1',
        },
      ],
      { fechaOperativa: '2026-06-05', fondoApertura: 200, modoPeriodo: 'sesion_apertura' },
    );

    expect(snap.total_comprobantes).toBe(2);
    expect(snap.ventas_brutas).toBe(1500);
    expect(snap.efectivo_ventas_periodo).toBe(1000);
    expect(snap.efectivo_esperado).toBe(1200);
    expect(snap.medios).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metodo_pago: 'efectivo', monto_neto: 1000 }),
        expect.objectContaining({ metodo_pago: 'credito', monto_neto: 500 }),
      ]),
    );
  });

  it('aporte efectivo en pago mixto', () => {
    expect(
      aporteEfectivoEnComprobante({
        id: 'x',
        total: 4200,
        tipo: 'ticket',
        metodo_pago: 'mixto',
        metodo_pago_detalle: { efectivo: 2000, debito: 2200 },
        caja_id: null,
      }),
    ).toBe(2000);
  });

  it('esVenta incluye ticket y facturas', () => {
    expect(esVenta('ticket')).toBe(true);
    expect(esVenta('factura_b')).toBe(true);
  });
});
