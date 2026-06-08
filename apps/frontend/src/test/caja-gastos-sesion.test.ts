import { describe, expect, it } from 'vitest';

import {
  fusionarGastosCierre,
  gastosSesionComoCierreItems,
  type CajaGastoSesionRow,
} from '@/lib/caja/caja-gastos-sesion';

const dbGastos: CajaGastoSesionRow[] = [
  { id: '1', concepto: 'Delivery', monto: 500, created_at: '2026-01-01T10:00:00Z', usuario_id: 'u1' },
  { id: '2', concepto: 'Cambio', monto: 200, created_at: '2026-01-01T11:00:00Z', usuario_id: 'u1' },
];

describe('caja-gastos-sesion', () => {
  it('convierte gastos de sesión a ítems de cierre', () => {
    expect(gastosSesionComoCierreItems(dbGastos)).toEqual([
      { concepto: 'Delivery', monto: 500 },
      { concepto: 'Cambio', monto: 200 },
    ]);
  });

  it('fusiona gastos del turno con extras del body', () => {
    const fusion = fusionarGastosCierre(dbGastos, [{ concepto: 'Limpieza', monto: 100 }]);
    expect(fusion.ok).toBe(true);
    if (!fusion.ok) return;
    expect(fusion.items).toEqual([
      { concepto: 'Delivery', monto: 500 },
      { concepto: 'Cambio', monto: 200 },
      { concepto: 'Limpieza', monto: 100 },
    ]);
    expect(fusion.total).toBe(800);
  });

  it('rechaza más de 25 líneas combinadas', () => {
    const muchos = Array.from({ length: 20 }, (_, i) => ({
      id: `s-${i}`,
      concepto: `S${i}`,
      monto: 10,
      created_at: '2026-01-01T10:00:00Z',
      usuario_id: null,
    }));
    const extras = Array.from({ length: 6 }, (_, i) => ({ concepto: `E${i}`, monto: 5 }));
    const fusion = fusionarGastosCierre(muchos, extras);
    expect(fusion.ok).toBe(false);
    if (fusion.ok) return;
    expect(fusion.error).toContain('25');
  });

  it('acepta solo gastos del turno sin extras', () => {
    const fusion = fusionarGastosCierre(dbGastos, []);
    expect(fusion.ok).toBe(true);
    if (!fusion.ok) return;
    expect(fusion.total).toBe(700);
    expect(fusion.items).toHaveLength(2);
  });
});
