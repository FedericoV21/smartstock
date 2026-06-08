import { describe, expect, it } from 'vitest';

import {
  BUSINESS_PREFS_KEYS,
  effectiveBusinessPrefsFromRows,
  mergeBusinessPrefsOverride,
  normalizeBusinessPrefs,
} from '@/lib/business-prefs/prefs';

describe('business prefs', () => {
  it('usa precioCostoSoloSube=false cuando la clave no existe', () => {
    expect(normalizeBusinessPrefs({}).precioCostoSoloSube).toBe(false);
  });

  it('usa mostrarResumenCierreCaja=true cuando la clave no existe', () => {
    expect(normalizeBusinessPrefs({}).mostrarResumenCierreCaja).toBe(true);
  });

  it('respeta mostrarResumenCierreCaja=false', () => {
    expect(normalizeBusinessPrefs({ mostrarResumenCierreCaja: false }).mostrarResumenCierreCaja).toBe(false);
  });

  it('vuelve al default si mostrarResumenCierreCaja no es booleano', () => {
    expect(normalizeBusinessPrefs({ mostrarResumenCierreCaja: 'no' }).mostrarResumenCierreCaja).toBe(true);
  });

  it('permite guardar la clave y resolver overrides por sucursal', () => {
    expect(BUSINESS_PREFS_KEYS).toContain('mostrarResumenCierreCaja');
    expect(
      effectiveBusinessPrefsFromRows(
        { mostrarResumenCierreCaja: true },
        { mostrarResumenCierreCaja: false },
      ).mostrarResumenCierreCaja,
    ).toBe(false);
  });

  it('normaliza gananciaHoraria por defecto', () => {
    expect(normalizeBusinessPrefs({}).gananciaHoraria).toEqual({
      habilitado: false,
      horaDesde: '00:00',
      horaHasta: '00:00',
      aumentoPuntosPct: 0,
    });
  });

  it('descarta valores invalidos de gananciaHoraria', () => {
    expect(
      normalizeBusinessPrefs({
        gananciaHoraria: {
          habilitado: 'si',
          horaDesde: '25:99',
          horaHasta: 'no',
          aumentoPuntosPct: -10,
        },
      }).gananciaHoraria,
    ).toEqual({
      habilitado: false,
      horaDesde: '00:00',
      horaHasta: '00:00',
      aumentoPuntosPct: 0,
    });
  });

  it('mergea override parcial de gananciaHoraria sin perder valores del negocio', () => {
    const tenant = normalizeBusinessPrefs({
      gananciaHoraria: {
        habilitado: true,
        horaDesde: '20:00',
        horaHasta: '01:30',
        aumentoPuntosPct: 5,
      },
    });
    expect(
      mergeBusinessPrefsOverride(tenant, {
        gananciaHoraria: { aumentoPuntosPct: 7 },
      }).gananciaHoraria,
    ).toEqual({
      habilitado: true,
      horaDesde: '20:00',
      horaHasta: '01:30',
      aumentoPuntosPct: 7,
    });
  });

  it('incluye gananciaHoraria entre claves validas', () => {
    expect(BUSINESS_PREFS_KEYS).toContain('gananciaHoraria');
  });
});
