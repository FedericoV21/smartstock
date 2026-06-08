import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbRef: { current: ReturnType<typeof createAdminMock> | null } = { current: null };

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => ({ value: 'valid-cookie' }),
  }),
}));

vi.mock('@/lib/nexus-dashboard/auth-cookie', () => ({
  NEXUS_DASHBOARD_COOKIE: 'nexus_dashboard_auth',
  verifyNexusDashboardSession: () => true,
}));

vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: () => dbRef.current,
}));

import { PATCH } from './route';

type Row = Record<string, any>;

class MockQuery {
  constructor(private rows: Row[]) {}

  select(): this {
    return this;
  }

  eq(column: string, value: unknown): this {
    this.rows = this.rows.filter((row) => row[column] === value);
    return this;
  }

  maybeSingle() {
    return Promise.resolve({ data: this.rows[0] ?? null, error: null });
  }
}

function createAdminMock() {
  const rpc = vi.fn().mockResolvedValue({ error: null });
  const tables: Record<string, Row[]> = {
    usuario: [{ id: 'user-1', tenant_id: 'tenant-1', rol: 'admin' }],
  };

  return {
    rpc,
    from(table: string) {
      return new MockQuery([...(tables[table] ?? [])]);
    },
  };
}

function patchPlan(plan: string) {
  return new Request('https://example.com/api/nexus-dashboard/tenants', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenantId: 'tenant-1',
      usuarioId: 'user-1',
      plan,
    }),
  });
}

describe('PATCH /api/nexus-dashboard/tenants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbRef.current = createAdminMock();
  });

  it('permite bajar una cuenta a Plan 0 desde Nexus', async () => {
    const res = await PATCH(patchPlan('plan0'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(dbRef.current?.rpc).toHaveBeenCalledWith('activar_plan', {
      p_tenant_id: 'tenant-1',
      p_plan: 'plan0',
    });
  });

  it('permite pasar una cuenta a plan base desde Nexus', async () => {
    const res = await PATCH(patchPlan('base'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(dbRef.current?.rpc).toHaveBeenCalledWith('activar_plan', {
      p_tenant_id: 'tenant-1',
      p_plan: 'base',
    });
  });
});
