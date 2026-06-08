import { parseFechaMp, parseMontoMp, rangoDiaArgentinaUtc } from './mp-transferencia-parse.util';
import { pagoToMovimiento } from './mp-transferencia-movimiento.util';

describe('mp-transferencia-parse.util', () => {
  it('rangoDiaArgentinaUtc cubre el día en UTC-3', () => {
    const { beginDateIso, endDateIso } = rangoDiaArgentinaUtc('2026-06-05');
    expect(beginDateIso).toBe('2026-06-05T03:00:00.000Z');
    expect(endDateIso).toBe('2026-06-06T03:00:00.000Z');
  });

  it('parseMontoMp acepta número y string', () => {
    expect(parseMontoMp(1500.5)).toBe(1500.5);
    expect(parseMontoMp('1500.50')).toBe(1500.5);
  });

  it('parseFechaMp devuelve ymd Argentina', () => {
    const r = parseFechaMp('2026-06-05T14:30:00.000-03:00');
    expect(r?.ymd).toBe('2026-06-05');
    expect(r?.iso).toBeTruthy();
  });
});

describe('mp-transferencia-movimiento.util', () => {
  it('pagoToMovimiento ignora pagos no approved', () => {
    expect(pagoToMovimiento({ id: 1, status: 'pending', transaction_amount: 100 })).toBeNull();
  });

  it('pagoToMovimiento mapea pago approved', () => {
    const m = pagoToMovimiento({
      id: 999,
      status: 'approved',
      transaction_amount: 1500,
      date_approved: '2026-06-05T12:00:00.000-03:00',
      currency_id: 'ARS',
      payment_type_id: 'bank_transfer',
    });
    expect(m?.mp_movimiento_id).toBe('999');
    expect(m?.monto).toBe(1500);
    expect(m?.fecha_operacion).toBe('2026-06-05');
  });
});
