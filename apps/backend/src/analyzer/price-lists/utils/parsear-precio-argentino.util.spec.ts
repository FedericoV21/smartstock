import { parsearPrecioArgentino } from './parsear-precio-argentino.util';

describe('parsearPrecioArgentino', () => {
  it('interpreta miles con punto (AR)', () => {
    expect(parsearPrecioArgentino('1.234,56')).toBe(1234.56);
    expect(parsearPrecioArgentino('5200')).toBe(5200);
  });

  it('interpreta formato US', () => {
    expect(parsearPrecioArgentino('5,200.00')).toBe(5200);
  });
});
