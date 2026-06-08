import { normalizeMpOrdersApiOrderId } from './mp-qr-api.client';

describe('mp-qr-api.client', () => {
  it('normalizeMpOrdersApiOrderId acepta ORD...', () => {
    expect(normalizeMpOrdersApiOrderId('ORD01HABCD1234567890123456789')).toBe(
      'ORD01HABCD1234567890123456789',
    );
    expect(normalizeMpOrdersApiOrderId('invalid')).toBeNull();
  });
});
