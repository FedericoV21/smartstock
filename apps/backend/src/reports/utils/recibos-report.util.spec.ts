import { armarResumenRecibos, etiquetaTipoPago, recibosACsv } from './recibos-report.util';

describe('recibos-report.util', () => {
  it('etiquetaTipoPago traduce enums', () => {
    expect(etiquetaTipoPago('efectivo')).toBe('Efectivo');
    expect(etiquetaTipoPago('desconocido')).toBe('desconocido');
  });

  it('arma resumen y csv', () => {
    const items = [
      {
        id: '1',
        fecha: '2026-06-01',
        numero: 10,
        total: 100,
        metodo_pago: 'Efectivo',
        cliente_nombre: 'Cliente A',
        origen: 'recibo' as const,
      },
      {
        id: 'pago-2',
        fecha: '2026-06-02',
        numero: null,
        total: 50,
        metodo_pago: 'Transferencia',
        cliente_nombre: 'Sin cliente',
        sin_comprobante_recibo: true,
        origen: 'cobranza_sin_recibo' as const,
      },
    ];
    const resumen = armarResumenRecibos(items);
    expect(resumen.cantidad).toBe(2);
    expect(resumen.total_monto).toBe(150);
    expect(resumen.sin_cliente).toBe(1);
    expect(recibosACsv(items)).toContain('Cliente A');
  });
});
