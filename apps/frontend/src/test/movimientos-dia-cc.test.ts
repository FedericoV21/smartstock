import { describe, expect, it } from 'vitest';

import {
  buildMovimientosDiaPayload,
  contarCargosHoyPorCliente,
  mapComprobantesAMovimientosDia,
  type MovimientoDiaComprobanteRow,
} from '@/lib/cuenta-corriente/movimientos-dia';

describe('movimientos-dia CC', () => {
  it('mapea comprobantes con ítems y totales', () => {
    const rows: MovimientoDiaComprobanteRow[] = [
      {
        id: 'c1',
        tipo: 'ticket',
        numero: null,
        numero_caja: 42,
        fecha: '2026-05-30',
        created_at: '2026-05-30T15:30:00.000Z',
        total: 1500,
        comprobante_item: [
          {
            id: 'i1',
            cantidad: 1.5,
            precio_unitario: 1000,
            subtotal: 1500,
            producto_variante_etiqueta: null,
            producto: {
              nombre: 'Bife',
              codigo: 'B01',
              unidad: 'kilo',
              es_pesable: true,
            },
          },
        ],
      },
    ];

    const mapped = mapComprobantesAMovimientosDia(rows, 1, { liquidacionHabilitada: true });
    expect(mapped).toHaveLength(1);
    expect(mapped[0].editable).toBe(true);
    expect(mapped[0].numeroLabel).toContain('42');
    expect(mapped[0].items[0].cantidadLabel).toContain('g');
    expect(mapped[0].total).toBe(1500);
  });

  it('arma payload con saldo sin cargos de hoy', () => {
    const payload = buildMovimientosDiaPayload({
      sucursalId: 's1',
      sucursalNombre: 'Depósito',
      saldoCuenta: 5000,
      comprobantes: [
        {
          id: 'c1',
          tipo: 'factura_b',
          numero: 10,
          numero_caja: null,
          fecha: '2026-05-30',
          created_at: '2026-05-30T12:00:00.000Z',
          total: 2000,
          comprobante_item: [],
        },
      ],
      puntoDeVenta: 1,
      fecha: '2026-05-30',
    });

    expect(payload.total_cargos_dia).toBe(2000);
    expect(payload.saldo_sin_cargos_hoy).toBe(3000);
    expect(payload.sucursal_nombre).toBe('Depósito');
  });

  it('cuenta cargos por cliente', () => {
    expect(
      contarCargosHoyPorCliente([
        { cliente_id: 'a' },
        { cliente_id: 'a' },
        { cliente_id: 'b' },
      ]),
    ).toEqual({ a: 2, b: 1 });
  });
});
