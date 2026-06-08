import { describe, expect, it } from 'vitest';

import {
  armarExtractoCuentaCorriente,
  comprobanteALineaExtracto,
  pagoALineaExtracto,
} from '@/lib/cuenta-corriente/extracto';

describe('extracto cuenta corriente', () => {
  it('convierte venta CC a cargo', () => {
    const l = comprobanteALineaExtracto(
      {
        id: 'c1',
        tipo: 'ticket',
        numero: null,
        numero_caja: 5,
        fecha: '2026-05-30',
        created_at: '2026-05-30T10:00:00Z',
        total: 1000,
        metodo_pago: 'cuenta_corriente',
        metodo_pago_detalle: null,
        sucursal_id: 's1',
      },
      1,
    );
    expect(l?.debe).toBe(1000);
    expect(l?.haber).toBe(0);
  });

  it('arma saldo corrido coherente con saldo actual', () => {
    const payload = armarExtractoCuentaCorriente({
      clienteId: 'cli',
      clienteNombre: 'Test',
      periodo: { desde: '2026-05-01', hasta: '2026-05-30', label: 'Mes' },
      sucursalId: null,
      saldoActual: 1500,
      comprobantes: [
        {
          id: 'c1',
          tipo: 'ticket',
          numero: 1,
          numero_caja: null,
          fecha: '2026-05-10',
          created_at: '2026-05-10T10:00:00Z',
          total: 2000,
          metodo_pago: 'cuenta_corriente',
          metodo_pago_detalle: null,
          sucursal_id: 's1',
        },
      ],
      pagos: [
        {
          id: 'p1',
          fecha: '2026-05-15',
          created_at: '2026-05-15T12:00:00Z',
          monto: 500,
          tipo_pago: 'efectivo',
          referencia: null,
          notas: null,
          comprobante_id: null,
        },
      ],
      puntoDeVenta: 1,
    });

    expect(payload.saldo_final).toBe(1500);
    expect(payload.lineas).toHaveLength(2);
    expect(payload.lineas[1].saldo).toBe(1500);
    expect(payload.saldo_inicial).toBe(0);
  });

  it('pago genera haber', () => {
    const l = pagoALineaExtracto({
      id: 'p1',
      fecha: '2026-05-30',
      created_at: '2026-05-30T12:00:00Z',
      monto: 300,
      tipo_pago: 'transferencia',
      referencia: null,
      notas: null,
      comprobante_id: null,
    });
    expect(l?.haber).toBe(300);
  });
});
