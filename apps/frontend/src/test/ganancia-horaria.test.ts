import { describe, expect, it } from 'vitest';

import {
  aumentoGananciaHorariaActivo,
  gananciaHorariaEstaActiva,
} from '@/lib/business-prefs/ganancia-horaria';
import { normalizeBusinessPrefs } from '@/lib/business-prefs/prefs';

describe('ganancia horaria', () => {
  it('activa dentro de un rango del mismo dia', () => {
    const prefs = {
      habilitado: true,
      horaDesde: '18:00',
      horaHasta: '22:00',
      aumentoPuntosPct: 5,
    };

    expect(gananciaHorariaEstaActiva(prefs, new Date('2026-01-02T22:30:00.000Z'))).toBe(true);
    expect(gananciaHorariaEstaActiva(prefs, new Date('2026-01-03T02:30:00.000Z'))).toBe(false);
  });

  it('activa en rangos que cruzan medianoche', () => {
    const prefs = {
      habilitado: true,
      horaDesde: '22:00',
      horaHasta: '02:00',
      aumentoPuntosPct: 5,
    };

    expect(gananciaHorariaEstaActiva(prefs, new Date('2026-01-02T02:00:00.000Z'))).toBe(true);
    expect(gananciaHorariaEstaActiva(prefs, new Date('2026-01-02T04:30:00.000Z'))).toBe(true);
    expect(gananciaHorariaEstaActiva(prefs, new Date('2026-01-02T06:00:00.000Z'))).toBe(false);
  });

  it('devuelve el aumento solo si la regla efectiva esta activa', () => {
    const prefs = normalizeBusinessPrefs({
      gananciaHoraria: {
        habilitado: true,
        horaDesde: '20:00',
        horaHasta: '23:00',
        aumentoPuntosPct: 7,
      },
    });

    expect(aumentoGananciaHorariaActivo(prefs, new Date('2026-01-03T00:30:00.000Z'))).toBe(7);
    expect(aumentoGananciaHorariaActivo(prefs, new Date('2026-01-03T03:30:00.000Z'))).toBe(0);
  });
});
