import { describe, expect, it } from 'vitest';

import {
  calcularVencimientoDia,
  vencimientoDefaultPersonalizado,
} from './pago-proveedor-vencimiento';

describe('calcularVencimientoDia', () => {
  it('días: 2026-04-01 + 30 días = 2026-05-01 (calendario)', () => {
    const r = calcularVencimientoDia({
      estado: 'pendiente_condicion',
      fechaFacturaYmd: '2026-04-01',
      proveedor: { condicion_pago_default: 'dias', plazo_pago_dias: 30 },
    });
    expect(r.vencimientoDiaYmd).toBe('2026-05-01');
    expect(r.condicion).toBe('dias');
  });

  it('contado: vence el mismo día de la factura', () => {
    const r = calcularVencimientoDia({
      estado: 'pendiente_condicion',
      fechaFacturaYmd: '2026-04-10',
      proveedor: { condicion_pago_default: 'contado', plazo_pago_dias: null },
    });
    expect(r.vencimientoDiaYmd).toBe('2026-04-10');
    expect(r.condicion).toBe('contado');
  });

  it('ya pagada: usa la fecha de pago para el vencimiento', () => {
    const r = calcularVencimientoDia({
      estado: 'ya_pagada',
      fechaFacturaYmd: '2026-01-20',
      proveedor: null,
      fechaPagoYmd: '2026-01-25',
    });
    expect(r.vencimientoDiaYmd).toBe('2026-01-25');
  });

  it('fecha fija: respeta vencimiento custom', () => {
    const r = calcularVencimientoDia({
      estado: 'pendiente_fecha_custom',
      fechaFacturaYmd: '2026-01-01',
      proveedor: null,
      vencimientoCustomYmd: '2026-12-15',
    });
    expect(r.vencimientoDiaYmd).toBe('2026-12-15');
    expect(r.condicion).toBe('fecha_fija');
  });
});

describe('vencimientoDefaultPersonalizado', () => {
  it('si hay sugerida IA, la usa', () => {
    expect(
      vencimientoDefaultPersonalizado('2026-01-10', '2026-01-20'),
    ).toBe('2026-01-20');
  });

  it('sin sugerida, +30 días', () => {
    expect(vencimientoDefaultPersonalizado('2026-01-10', null)).toBe('2026-02-09');
  });
});
