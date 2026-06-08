import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getTenantSession: vi.fn(),
  rejectIfVisor: vi.fn(),
}));

vi.mock('@/lib/api/tenant-session', () => ({
  getTenantSession: mocks.getTenantSession,
  rejectIfVisor: mocks.rejectIfVisor,
}));

import { POST } from './route';

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

function createSupabaseMock(opts: { tenantPlan: string; usuarioRol?: string }) {
  const rpc = vi.fn().mockResolvedValue({ error: null });
  const tables: Record<string, Row[]> = {
    usuario: [{ id: 'user-1', rol: opts.usuarioRol ?? 'admin' }],
    tenant: [{ id: 'tenant-1', plan: opts.tenantPlan }],
  };

  return {
    rpc,
    from(table: string) {
      return new MockQuery([...(tables[table] ?? [])]);
    },
  };
}

function requestPlan(plan: string) {
  return new Request('https://example.com/api/configuracion/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan }),
  });
}

describe('POST /api/configuracion/plan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rejectIfVisor.mockReturnValue(null);
  });

  it('rechaza upgrade self-service cuando el tenant esta en Plan 0', async () => {
    const supabase = createSupabaseMock({ tenantPlan: 'plan0' });
    mocks.getTenantSession.mockResolvedValue({
      supabase,
      tenantId: 'tenant-1',
      userId: 'user-1',
      rol: 'admin',
    });

    const res = await POST(requestPlan('base'));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toContain('Plan 0');
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('mantiene habilitado el cambio self-service para planes pagos actuales', async () => {
    const supabase = createSupabaseMock({ tenantPlan: 'base' });
    mocks.getTenantSession.mockResolvedValue({
      supabase,
      tenantId: 'tenant-1',
      userId: 'user-1',
      rol: 'admin',
    });

    const res = await POST(requestPlan('intermedio'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ success: true, plan: 'intermedio' });
    expect(supabase.rpc).toHaveBeenCalledWith('activar_plan', {
      p_tenant_id: 'tenant-1',
      p_plan: 'intermedio',
    });
  });
});
