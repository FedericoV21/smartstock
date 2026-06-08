import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbRef: { current: MockDb | null } = { current: null };
const mocks = vi.hoisted(() => ({
  preparar: vi.fn(),
  aplicar: vi.fn(),
}));

vi.mock('@/lib/supabase/env-keys', () => ({
  getSupabaseServiceRoleKey: () => 'service-role',
}));

vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: () => dbRef.current,
}));

vi.mock('@/lib/api-integraciones/keys', () => ({
  authenticateApiIntegrationKey: vi.fn(async () => ({
    ok: true,
    key: { id: 'key-1' },
    tenantId: 'tenant-1',
    sucursalId: 'suc-1',
    userId: 'user-1',
  })),
}));

vi.mock('@/lib/lector-facturas/confirmacion-chatbot', () => ({
  prepararConfirmacionLectorFacturaDesdeResultado: (...args: any[]) => mocks.preparar(...args),
  aplicarConfirmacionLectorFacturaJob: (...args: any[]) => mocks.aplicar(...args),
}));

import { POST } from './route';

type Row = Record<string, any>;

class MockQuery implements PromiseLike<{ data: any; error: any }> {
  private updatePayload: Row | null = null;

  constructor(
    private db: MockDb,
    private table: string,
    private rows: Row[],
  ) {}

  select(): this {
    return this;
  }

  eq(column: string, value: unknown): this {
    this.rows = this.rows.filter((row) => row[column] === value);
    return this;
  }

  update(payload: Row): this {
    this.updatePayload = payload;
    return this;
  }

  maybeSingle() {
    return Promise.resolve({ data: this.rows[0] ?? null, error: null });
  }

  then<TResult1 = { data: any; error: any }, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    if (this.updatePayload) {
      this.db.tables[this.table] = (this.db.tables[this.table] ?? []).map((row) =>
        this.rows.some((match) => match.id === row.id) ? { ...row, ...this.updatePayload } : row,
      );
    }
    return Promise.resolve({ data: this.rows, error: null }).then(onfulfilled, onrejected);
  }
}

class MockDb {
  constructor(public tables: Record<string, Row[]>) {}

  from(table: string) {
    return new MockQuery(this, table, [...(this.tables[table] ?? [])]);
  }
}

function createDb() {
  return new MockDb({
    lector_factura_job: [
      {
        id: 'job-1',
        tenant_id: 'tenant-1',
        api_key_id: 'key-1',
        sucursal_id: 'suc-1',
        usuario_id: 'user-1',
        status: 'completed',
        resultado: { log_id: 'log-1', items: [], cabecera: {} },
        application_status: 'pending',
        applied_comprobante_id: null,
      },
    ],
  });
}

function request(body: unknown) {
  return new Request('https://example.com/api/public/lector-facturas/jobs/job-1/confirmar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/public/lector-facturas/jobs/:id/confirmar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbRef.current = createDb();
    mocks.preparar.mockResolvedValue({
      impacto: { bloqueantes: [], resumen: {}, cambios_costos: [], advertencias: [], conflictos: [] },
      impactHash: 'hash-1',
      confirmPayload: { log_id: 'log-1' },
    });
    mocks.aplicar.mockResolvedValue({
      ok: true,
      comprobante_id: 'comp-1',
      actualizaciones_costos: [],
      impacto: { bloqueantes: [] },
      impact_hash: 'hash-1',
      idempotent_replay: false,
    });
  });

  it('devuelve 428 con impacto/hash si falta confirmacion explicita', async () => {
    const res = await POST(request({}), { params: Promise.resolve({ id: 'job-1' }) });
    const json = await res.json();

    expect(res.status).toBe(428);
    expect(json.impact_hash).toBe('hash-1');
    expect(mocks.preparar).toHaveBeenCalled();
    expect(mocks.aplicar).not.toHaveBeenCalled();
  });

  it('aplica cuando recibe confirm=true y accepted_impact_hash', async () => {
    const res = await POST(request({ confirm: true, accepted_impact_hash: 'hash-1' }), {
      params: Promise.resolve({ id: 'job-1' }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.comprobante_id).toBe('comp-1');
    expect(mocks.aplicar).toHaveBeenCalledWith(expect.objectContaining({
      acceptedImpactHash: 'hash-1',
    }));
  });
});
