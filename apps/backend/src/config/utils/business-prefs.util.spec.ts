import {
  DEFAULT_BUSINESS_PREFS,
  effectiveBusinessPrefsFromRows,
  mergeBusinessPrefsOverride,
  normalizeBusinessPrefs,
} from './business-prefs.util';

describe('business-prefs.util', () => {
  it('normalizes defaults when raw is null', () => {
    expect(normalizeBusinessPrefs(null)).toEqual(DEFAULT_BUSINESS_PREFS);
  });

  it('merges sucursal override on tenant base', () => {
    const tenant = { ...DEFAULT_BUSINESS_PREFS, precioCostoSoloSube: true };
    const effective = effectiveBusinessPrefsFromRows(tenant, {
      registrarLotesPorIngreso: false,
    });
    expect(effective.precioCostoSoloSube).toBe(true);
    expect(effective.registrarLotesPorIngreso).toBe(false);
  });

  it('mergeBusinessPrefsOverride deep-merges gananciaHoraria', () => {
    const merged = mergeBusinessPrefsOverride(DEFAULT_BUSINESS_PREFS, {
      gananciaHoraria: { habilitado: true },
    });
    expect(merged.gananciaHoraria.habilitado).toBe(true);
    expect(merged.gananciaHoraria.horaDesde).toBe('00:00');
  });
});
