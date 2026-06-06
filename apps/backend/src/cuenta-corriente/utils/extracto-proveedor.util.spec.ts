import {
  armarExtractoProveedor,
  obligacionALineaExtracto,
  pagoProveedorALineaExtracto,
} from './extracto-proveedor.util';

describe('extracto-proveedor.util', () => {
  it('convierte obligaci├│n con comprobante a l├¡nea cargo', () => {
    const linea = obligacionALineaExtracto({
      id: 'o1',
      monto_original: 1000,
      origen: 'comprobante',
      referencia: null,
      created_at: '2026-06-01T10:00:00.000Z',
      estado: 'pendiente',
      comprobante: { tipo: 'factura_a', numero: 42, fecha: '2026-06-01' },
    });
    expect(linea?.tipo).toBe('cargo');
    expect(linea?.debe).toBe(1000);
    expect(linea?.haber).toBe(0);
  });

  it('convierte pago a l├¡nea haber', () => {
    const linea = pagoProveedorALineaExtracto({
      id: 'p1',
      fecha: '2026-06-02',
      created_at: '2026-06-02T12:00:00.000Z',
      monto: 500,
      tipo_pago: 'efectivo',
      referencia: null,
      notas: 'Anticipo',
    });
    expect(linea?.tipo).toBe('pago');
    expect(linea?.haber).toBe(500);
    expect(linea?.descripcion).toContain('Anticipo');
  });

  it('arma extracto con saldo inicial derivado del per├¡odo', () => {
    const payload = armarExtractoProveedor({
      proveedorId: 'prov-1',
      proveedorNombre: 'Arcor',
      periodo: { desde: '2026-06-01', hasta: '2026-06-30', label: 'Junio 2026' },
      saldoActual: 500,
      obligaciones: [
        {
          id: 'o1',
          monto_original: 1000,
          origen: 'comprobante',
          referencia: null,
          created_at: '2026-06-01T10:00:00.000Z',
          estado: 'pendiente',
          comprobante: { tipo: 'factura_a', numero: 1, fecha: '2026-06-01' },
        },
      ],
      pagos: [
        {
          id: 'p1',
          fecha: '2026-06-02',
          created_at: '2026-06-02T12:00:00.000Z',
          monto: 500,
          tipo_pago: 'efectivo',
          referencia: null,
          notas: null,
        },
      ],
    });
    expect(payload.saldo_final).toBe(500);
    expect(payload.saldo_inicial).toBe(0);
    expect(payload.lineas).toHaveLength(2);
    expect(payload.total_debe).toBe(1000);
    expect(payload.total_haber).toBe(500);
  });
});
