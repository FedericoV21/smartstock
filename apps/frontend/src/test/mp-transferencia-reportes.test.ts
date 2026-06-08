import { describe, expect, it } from 'vitest';

import {
  MpTransferenciaReporteError,
  filtrarCoincidenciasMpTransferencia,
  parseFechaMp,
  parseMpTransferenciaCsv,
} from '@/lib/mp-transferencia/reportes';

function csv(rows: string[][]): string {
  return rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
}

describe('mp-transferencia reportes', () => {
  it('matchea monto exacto a centavos y excluye movimientos ya usados', () => {
    const movimientos = parseMpTransferenciaCsv(
      csv([
        ['SOURCE_ID', 'DATE', 'NET_AMOUNT', 'STATUS', 'TRANSACTION_TYPE'],
        ['mov-1', '22/05/2026', '1000.00', 'approved', 'transfer'],
        ['mov-2', '22/05/2026', '1000.01', 'approved', 'transfer'],
        ['mov-3', '22/05/2026', '1000.00', 'approved', 'transfer'],
      ]),
    );

    const matches = filtrarCoincidenciasMpTransferencia(movimientos, {
      fecha: '2026-05-22',
      monto: 1000,
      usados: new Set(['mov-3']),
    });

    expect(matches.map((m) => m.mp_movimiento_id)).toEqual(['mov-1']);
  });

  it('interpreta fechas ISO con zona horaria como dia Argentina', () => {
    expect(parseFechaMp('2026-05-22T02:30:00.000Z')?.ymd).toBe('2026-05-21');
    expect(parseFechaMp('22/05/2026')?.ymd).toBe('2026-05-22');
  });

  it('solo importa movimientos positivos y aprobados/acreditados', () => {
    const movimientos = parseMpTransferenciaCsv(
      csv([
        ['SOURCE_ID', 'DATE', 'NET_AMOUNT', 'STATUS', 'TRANSACTION_TYPE'],
        ['ok-1', '22/05/2026', '500', 'approved', 'transfer'],
        ['bad-negative', '22/05/2026', '-500', 'approved', 'transfer'],
        ['bad-pending', '22/05/2026', '500', 'pending', 'transfer'],
        ['bad-refund', '22/05/2026', '500', 'approved', 'refund'],
        ['ok-2', '22/05/2026', '500', 'accredited', 'income'],
      ]),
    );

    expect(movimientos.map((m) => m.mp_movimiento_id)).toEqual(['ok-1', 'ok-2']);
  });

  it('devuelve multiples coincidencias cuando hay dos movimientos del mismo importe', () => {
    const movimientos = parseMpTransferenciaCsv(
      csv([
        ['SOURCE_ID', 'DATE', 'NET_AMOUNT', 'STATUS', 'TRANSACTION_TYPE'],
        ['mov-1', '22/05/2026', '750', 'approved', 'transfer'],
        ['mov-2', '22/05/2026', '750', 'approved', 'transfer'],
      ]),
    );

    const matches = filtrarCoincidenciasMpTransferencia(movimientos, {
      fecha: '2026-05-22',
      monto: 750,
    });

    expect(matches).toHaveLength(2);
  });

  it('rechaza CSV sin identificador estable del movimiento', () => {
    expect(() =>
      parseMpTransferenciaCsv(
        csv([
          ['DATE', 'NET_AMOUNT', 'STATUS', 'TRANSACTION_TYPE'],
          ['22/05/2026', '1000', 'approved', 'transfer'],
        ]),
      ),
    ).toThrow(MpTransferenciaReporteError);
  });
});
