import { effectiveBusinessPrefs, resolveCajaTesoreriaFilter } from './business-prefs-tesoreria.util';

describe('business-prefs-tesoreria.util', () => {
  it('hereda cajaInterna del tenant', () => {
    const prefs = effectiveBusinessPrefs({ cajaInterna: { habilitado: true, alcance: 'tenant' } }, null);
    expect(prefs.cajaInterna.habilitado).toBe(true);
    expect(prefs.cajaInterna.alcance).toBe('tenant');
  });

  it('resolveCajaTesoreriaFilter exige sucursal en alcance sucursal', () => {
    expect(() => resolveCajaTesoreriaFilter('sucursal', null)).toThrow();
    expect(resolveCajaTesoreriaFilter('sucursal', 'suc-1').sucursalId).toBe('suc-1');
  });
});
