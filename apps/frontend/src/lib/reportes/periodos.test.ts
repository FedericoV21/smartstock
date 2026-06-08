import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  finDiaArgentinaIsoUtc,
  horaArgentina,
  inicioDiaArgentinaIsoUtc,
  resolverPeriodoReporte,
  ymdArgentina,
} from './periodos';

afterEach(() => {
  vi.useRealTimers();
});

describe('periodos de reportes en Argentina', () => {
  it('calcula hoy con calendario argentino cerca del cambio de dia UTC', () => {
    expect(ymdArgentina(new Date('2026-05-20T02:30:00.000Z'))).toBe('2026-05-19');
  });

  it('resuelve hoy y semana usando America/Argentina/Buenos_Aires', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-20T02:30:00.000Z'));

    expect(resolverPeriodoReporte(new URLSearchParams('periodo=hoy'), { defaultKey: 'hoy' })).toEqual({
      key: 'hoy',
      desde: '2026-05-19',
      hasta: '2026-05-19',
    });
    expect(resolverPeriodoReporte(new URLSearchParams('periodo=semana'), { defaultKey: 'hoy' })).toEqual({
      key: 'semana',
      desde: '2026-05-18',
      hasta: '2026-05-19',
    });
  });

  it('resuelve el mes actual sin adelantarse por UTC', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T02:30:00.000Z'));

    expect(resolverPeriodoReporte(new URLSearchParams('periodo=mes'))).toEqual({
      key: 'mes',
      desde: '2026-05-01',
      hasta: '2026-05-31',
    });
  });

  it('resuelve rango con una sola fecha como ese dia', () => {
    expect(resolverPeriodoReporte(new URLSearchParams('periodo=rango&desde=2026-05-07'))).toEqual({
      key: 'rango',
      desde: '2026-05-07',
      hasta: '2026-05-07',
    });
    expect(resolverPeriodoReporte(new URLSearchParams('periodo=rango&hasta=2026-05-09'))).toEqual({
      key: 'rango',
      desde: '2026-05-09',
      hasta: '2026-05-09',
    });
  });

  it('resuelve rango con dos fechas incluyendo ambos extremos', () => {
    expect(
      resolverPeriodoReporte(new URLSearchParams('periodo=rango&desde=2026-05-07&hasta=2026-05-10')),
    ).toEqual({
      key: 'rango',
      desde: '2026-05-07',
      hasta: '2026-05-10',
    });
  });

  it('convierte un dia argentino completo a rango UTC para created_at', () => {
    expect(inicioDiaArgentinaIsoUtc('2026-05-19')).toBe('2026-05-19T03:00:00.000Z');
    expect(finDiaArgentinaIsoUtc('2026-05-19')).toBe('2026-05-20T02:59:59.999Z');
  });

  it('agrupa horas de timestamps en hora argentina', () => {
    expect(horaArgentina('2026-05-20T02:30:00.000Z')).toBe(23);
    expect(horaArgentina('2026-05-19T03:15:00.000Z')).toBe(0);
  });
});
