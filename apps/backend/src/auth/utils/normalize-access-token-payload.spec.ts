import { normalizeAccessTokenPayload } from './normalize-access-token-payload';

describe('normalizeAccessTokenPayload', () => {
  it('promueve tenant_id y rol desde app_metadata', () => {
    const out = normalizeAccessTokenPayload({
      sub: 'u1',
      role: 'authenticated',
      app_metadata: { tenant_id: 't1', rol: 'admin' },
    });
    expect(out.tenant_id).toBe('t1');
    expect(out.rol).toBe('admin');
  });

  it('no pisa claims ya definidos en la ra├¡z', () => {
    const out = normalizeAccessTokenPayload({
      sub: 'u1',
      tenant_id: 'root-tenant',
      app_metadata: { tenant_id: 'ignored' },
    });
    expect(out.tenant_id).toBe('root-tenant');
  });
});
