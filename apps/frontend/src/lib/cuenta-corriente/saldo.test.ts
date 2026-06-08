import { describe, expect, it } from 'vitest';

import {
  calcularSaldoPendienteNuevoCargo,
  clasificarSaldoCuentaCorriente,
  describirSaldoCuentaCorriente,
} from './saldo';

describe('saldo cuenta corriente', () => {
  it('clasifica deuda, saldo a favor y saldos cercanos a cero', () => {
    expect(clasificarSaldoCuentaCorriente(120)).toBe('deuda');
    expect(clasificarSaldoCuentaCorriente(-50)).toBe('saldo_a_favor');
    expect(clasificarSaldoCuentaCorriente(0.005)).toBe('sin_saldo');
  });

  it('describe el signo segun cliente o proveedor', () => {
    expect(describirSaldoCuentaCorriente(-30, 'cliente')).toMatchObject({
      estado: 'saldo_a_favor',
      titulo: 'Saldo a favor del cliente',
      monto: 30,
    });
    expect(describirSaldoCuentaCorriente(-30, 'proveedor')).toMatchObject({
      estado: 'saldo_a_favor',
      titulo: 'Saldo a favor del tenant',
      monto: 30,
    });
  });

  it('aplica creditos previos al saldo pendiente de un cargo nuevo', () => {
    expect(calcularSaldoPendienteNuevoCargo(120, 100)).toBe(100);
    expect(calcularSaldoPendienteNuevoCargo(40, 100)).toBe(40);
    expect(calcularSaldoPendienteNuevoCargo(-20, 100)).toBe(0);
  });
});
