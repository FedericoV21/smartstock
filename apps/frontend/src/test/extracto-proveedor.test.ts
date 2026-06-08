import { describe, expect, it } from 'vitest';

import {
  armarExtractoProveedor,
  obligacionALineaExtracto,
  pagoProveedorALineaExtracto,
} from '@/lib/proveedores/extracto-proveedor';

describe('extracto cuenta corriente proveedor', () => {
  it('convierte obligación a cargo (debe)', () => {
    const l = obligacionALineaExtracto({
      id: 'o1',
      monto_original: 5000,
      origen: 'comprobante',
      referencia: null,
      created_at: '2026-05-10T10:00:00Z',
      estado: 'pendiente',
      comprobante: { tipo: 'factura_compra', numero: 42, fecha: '2026-05-10' },
    });
    expect(l?.debe).toBe(5000);
    expect(l?.haber).toBe(0);
    expect(l?.fecha).toBe('2026-05-10');
  });

  it('pago genera haber', () => {
    const l = pagoProveedorALineaExtracto({
      id: 'p1',
      fecha: '2026-05-15',
      created_at: '2026-05-15T12:00:00Z',
      monto: 2000,
      tipo_pago: 'transferencia',
      referencia: null,
      notas: null,
    });
    expect(l?.haber).toBe(2000);
    expect(l?.debe).toBe(0);
  });

  it('arma saldo corrido coherente con saldo actual', () => {
    const payload = armarExtractoProveedor({
      proveedorId: 'prov',
      proveedorNombre: 'Distribuidora Test',
      periodo: { desde: '2026-05-01', hasta: '2026-05-30', label: 'Mes' },
      saldoActual: 3000,
      obligaciones: [
        {
          id: 'o1',
          monto_original: 5000,
          origen: 'comprobante',
          referencia: null,
          created_at: '2026-05-10T10:00:00Z',
          estado: 'parcial',
          comprobante: { tipo: 'factura_compra', numero: 1, fecha: '2026-05-10' },
        },
      ],
      pagos: [
        {
          id: 'p1',
          fecha: '2026-05-20',
          created_at: '2026-05-20T12:00:00Z',
          monto: 2000,
          tipo_pago: 'efectivo',
          referencia: null,
          notas: null,
        },
      ],
    });

    expect(payload.saldo_final).toBe(3000);
    expect(payload.lineas).toHaveLength(2);
    expect(payload.lineas[1].saldo).toBe(3000);
    expect(payload.saldo_inicial).toBe(0);
  });
});
