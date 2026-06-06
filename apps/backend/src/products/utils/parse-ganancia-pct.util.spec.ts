import { parseGananciaPct } from './parse-ganancia-pct.util';

describe('parseGananciaPct', () => {
  it('acepta n├║meros v├ílidos', () => {
    expect(parseGananciaPct(35)).toBe(35);
    expect(parseGananciaPct('42,5')).toBe(42.5);
  });

  it('rechaza fuera de rango', () => {
    expect(parseGananciaPct(-1)).toBeNull();
    expect(parseGananciaPct(1000)).toBeNull();
  });
});
