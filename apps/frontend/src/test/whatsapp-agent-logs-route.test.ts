import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  moduloGuardAny: vi.fn(),
  getTenantSession: vi.fn(),
}));

vi.mock('@/lib/modulos/guard', () => ({
  moduloGuardAny: (...args: unknown[]) => mocks.moduloGuardAny(...args),
}));

vi.mock('@/lib/api/tenant-session', () => ({
  getTenantSession: (...args: unknown[]) => mocks.getTenantSession(...args),
}));

import { GET } from '@/app/api/whatsapp/logs/route';

type Row = Record<string, unknown>;

class MockQueryBuilder implements PromiseLike<{ data: Row[]; error: { message: string } | null }> {
  private rows: Row[];

  constructor(rows: Row[]) {
    this.rows = [...rows];
  }

  select(): this {
    return this;
  }

  eq(column: string, value: unknown): this {
    this.rows = this.rows.filter((row) => row[column] === value);
    return this;
  }

  lt(column: string, value: string): this {
    this.rows = this.rows.filter((row) => String(row[column] ?? '') < value);
    return this;
  }

  gte(column: string, value: string): this {
    this.rows = this.rows.filter((row) => String(row[column] ?? '') >= value);
    return this;
  }

  lte(column: string, value: string): this {
    this.rows = this.rows.filter((row) => String(row[column] ?? '') <= value);
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    const ascending = options?.ascending ?? true;
    this.rows = [...this.rows].sort((a, b) => {
      const av = String(a[column] ?? '');
      const bv = String(b[column] ?? '');
      return ascending ? av.localeCompare(bv) : bv.localeCompare(av);
    });
    return this;
  }

  limit(count: number): this {
    this.rows = this.rows.slice(0, count);
    return this;
  }

  or(expression: string): this {
    const clauses = expression
      .split(',')
      .map((part) => part.trim())
      .map((part) => part.match(/^([a-z0-9_]+)\.ilike\.%(.*)%$/i))
      .filter((match): match is RegExpMatchArray => Boolean(match));

    this.rows = this.rows.filter((row) =>
      clauses.some((match) =>
        String(row[match[1]] ?? '').toLowerCase().includes(match[2].toLowerCase()),
      ),
    );
    return this;
  }

  then<TResult1 = { data: Row[]; error: { message: string } | null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: Row[]; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: this.rows, error: null }).then(onfulfilled, onrejected);
  }
}

function supabaseWith(rows: Row[]) {
  return {
    from: vi.fn((table: string) => {
      expect(table).toBe('whatsapp_agent_turn_log');
      return new MockQueryBuilder(rows);
    }),
  };
}

function session(params: { rol?: string; isSuperAdmin?: boolean; rows?: Row[] } = {}) {
  return {
    tenantId: 'tenant-1',
    userId: 'user-1',
    rol: params.rol ?? 'admin',
    isSuperAdmin: params.isSuperAdmin ?? false,
    supabase: supabaseWith(params.rows ?? []),
  };
}

function req(query = '') {
  return new Request(`http://test.local/api/whatsapp/logs${query}`);
}

describe('GET /api/whatsapp/logs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.moduloGuardAny.mockResolvedValue({ allowed: true });
  });

  it('rechaza operadores y visor con 403', async () => {
    mocks.getTenantSession.mockResolvedValue(session({ rol: 'operador' }));

    const res = await GET(req());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('admin');
  });

  it('lista logs tenant-scoped con filtros de canal, tool, busqueda y paginacion', async () => {
    const rows: Row[] = [
      {
        id: 'log-1',
        tenant_id: 'tenant-1',
        created_at: '2026-05-28T12:00:00.000Z',
        channel: 'sandbox',
        status: 'success',
        tool_name: 'getReport:stock_bajo',
        intent: 'reporte_stock_bajo',
        input_body: 'stock critico',
        reply_body: 'Productos con stock bajo',
      },
      {
        id: 'log-2',
        tenant_id: 'tenant-1',
        created_at: '2026-05-28T11:00:00.000Z',
        channel: 'sandbox',
        status: 'success',
        tool_name: 'getReport:stock_bajo',
        intent: 'reporte_stock_bajo',
        input_body: 'stock bajo',
        reply_body: 'Otro resultado',
      },
      {
        id: 'log-3',
        tenant_id: 'tenant-1',
        created_at: '2026-05-28T10:00:00.000Z',
        channel: 'live',
        status: 'success',
        tool_name: 'getProductStock',
        intent: 'stock_producto',
        input_body: 'stock coca',
        reply_body: 'Stock total',
      },
      {
        id: 'log-other',
        tenant_id: 'tenant-2',
        created_at: '2026-05-28T13:00:00.000Z',
        channel: 'sandbox',
        status: 'success',
        tool_name: 'getReport:stock_bajo',
        intent: 'reporte_stock_bajo',
        input_body: 'stock critico',
      },
    ];
    mocks.getTenantSession.mockResolvedValue(session({ rows }));

    const res = await GET(req('?channel=sandbox&tool=getReport%3Astock_bajo&q=stock&limit=1'));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.logs).toHaveLength(1);
    expect(body.logs[0].id).toBe('log-1');
    expect(body.nextCursor).toBe('2026-05-28T12:00:00.000Z');
  });
});
