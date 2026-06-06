import { effectivePosPricingPrefs } from './effective-pos-prefs.util';

describe('effectivePosPricingPrefs', () => {
  it('hereda defaults sin prefs', () => {
    expect(effectivePosPricingPrefs(null, null)).toEqual({
      redondearPreciosCentenas: false,
      redondearMenores100ADecenas: false,
    });
  });

  it('fusiona tenant y sucursal', () => {
    expect(
      effectivePosPricingPrefs(
        { pvpRedondeoCentenasArriba: true },
        { pvpRedondeoMenores100ADecenas: true },
      ),
    ).toEqual({
      redondearPreciosCentenas: true,
      redondearMenores100ADecenas: true,
    });
  });
});
