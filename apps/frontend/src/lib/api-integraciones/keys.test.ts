import { describe, expect, it } from 'vitest';

import {
  authenticateApiIntegrationKey,
  hashApiIntegrationKey,
  previewApiIntegrationKey,
} from './keys';

type Row = Record<string, any>;

class MockQuery implements PromiseLike<{ data: any; error: any }> {
  constructor(
    private rows: Row[],
    private onUpdate?: (payload: Row, rows: Row[]) => void,
  ) {}

  select(): this {
    return this;
  }

  eq(column: string, value: unknown): this {
    this.rows = this.rows.filter((row) => row[column] === value);
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.rows = this.rows.filter((row) => values.includes(row[column]));
    return this;
  }

  order(): this {
    return this;
  }

  limit(count: number): this {
    this.rows = this.rows.slice(0, count);
    return this;
  }

  update(payload: Row): this {
    this.onUpdate?.(payload, this.rows);
    this.rows = this.rows.map((row) => ({ ...row, ...payload }));
    return this;
  }

  maybeSingle() {
    return Promise.resolve({ data: this.rows[0] ?? null, error: null });
  }

  then<TResult1 = { data: any; error: any }, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: this.rows, error: null }).then(onfulfilled, onrejected);
  }
}

function createDb(rows: { key: Row; modulo?: Row; sucursal?: Row }) {
  const tables: Record<string, Row[]> = {
    api_integracion_key: [rows.key],
    modulo_config: [rows.modulo ?? { tenant_id: 'tenant-1', lector_facturas: true, facturador_simple: false }],
    sucursal: [rows.sucursal ?? { id: 'suc-1', tenant_id: 'tenant-1', activa: true }],
  };
  return {
    tables,
    from(table: string) {
      return new MockQuery([...(tables[table] ?? [])], (payload, matchedRows) => {
        tables[table] = (tables[table] ?? []).map((row) =>
          matchedRows.some((m) => m.id === row.id) ? { ...row, ...payload } : row,
        );
      });
    },
  };
}

function requestWithToken(token: string) {
  return new Request('https://example.com/api/public/lector-facturas/jobs', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe('api integration keys', () => {
  it('hashea y previsualiza el token sin guardar el valor plano', () => {
    expect(hashApiIntegrationKey('secret-token')).toBe(hashApiIntegrationKey('secret-token'));
    expect(hashApiIntegrationKey('secret-token')).not.toBe('secret-token');
    expect(previewApiIntegrationKey('abcdef123456')).toBe('abcd...3456');
  });

  it('autentica una API key activa con scope del lector', async () => {
    const token = 'ss_test_123';
    const db = createDb({
      key: {
        id: 'key-1',
        tenant_id: 'tenant-1',
        sucursal_id: 'suc-1',
        usuario_id: 'user-1',
        nombre: 'Chatbot',
        key_hash: hashApiIntegrationKey(token),
        scopes: ['lector_facturas:jobs:create'],
        estado: 'activa',
        rate_limit_por_minuto: 10,
      },
    });

    const auth = await authenticateApiIntegrationKey({
      db,
      request: requestWithToken(token),
      scope: 'lector_facturas:jobs:create',
      consumeRateLimit: false,
    });

    expect(auth.ok).toBe(true);
    if (!auth.ok) throw new Error(auth.error);
    expect(auth.tenantId).toBe('tenant-1');
    expect(auth.sucursalId).toBe('suc-1');
    expect(auth.userId).toBe('user-1');
    expect(db.tables.api_integracion_key[0]?.last_used_at).toBeTruthy();
  });

  it('autentica scope de confirmacion y no lo concede con read legacy', async () => {
    const token = 'ss_test_confirm';
    const allowed = await authenticateApiIntegrationKey({
      db: createDb({
        key: {
          id: 'key-1',
          tenant_id: 'tenant-1',
          sucursal_id: 'suc-1',
          usuario_id: 'user-1',
          nombre: 'Chatbot',
          key_hash: hashApiIntegrationKey(token),
          scopes: ['lector_facturas:jobs:confirm'],
          estado: 'activa',
          rate_limit_por_minuto: 10,
        },
      }),
      request: requestWithToken(token),
      scope: 'lector_facturas:jobs:confirm',
      consumeRateLimit: false,
    });
    expect(allowed.ok).toBe(true);

    const denied = await authenticateApiIntegrationKey({
      db: createDb({
        key: {
          id: 'key-2',
          tenant_id: 'tenant-1',
          sucursal_id: 'suc-1',
          usuario_id: 'user-1',
          nombre: 'Chatbot',
          key_hash: hashApiIntegrationKey(token),
          scopes: ['lector_facturas:read'],
          estado: 'activa',
          rate_limit_por_minuto: 10,
        },
      }),
      request: requestWithToken(token),
      scope: 'lector_facturas:jobs:confirm',
      consumeRateLimit: false,
    });
    expect(denied).toMatchObject({ ok: false, status: 403 });
  });

  it('rechaza keys revocadas o sin scope suficiente', async () => {
    const token = 'ss_test_456';
    const revoked = await authenticateApiIntegrationKey({
      db: createDb({
        key: {
          id: 'key-1',
          tenant_id: 'tenant-1',
          sucursal_id: 'suc-1',
          usuario_id: 'user-1',
          nombre: 'Chatbot',
          key_hash: hashApiIntegrationKey(token),
          scopes: ['lector_facturas:jobs:create'],
          estado: 'revocada',
          rate_limit_por_minuto: 10,
        },
      }),
      request: requestWithToken(token),
      scope: 'lector_facturas:jobs:create',
      consumeRateLimit: false,
    });
    expect(revoked).toMatchObject({ ok: false, status: 403 });

    const insufficient = await authenticateApiIntegrationKey({
      db: createDb({
        key: {
          id: 'key-2',
          tenant_id: 'tenant-1',
          sucursal_id: 'suc-1',
          usuario_id: 'user-1',
          nombre: 'Chatbot',
          key_hash: hashApiIntegrationKey(token),
          scopes: ['otro:scope'],
          estado: 'activa',
          rate_limit_por_minuto: 10,
        },
      }),
      request: requestWithToken(token),
      scope: 'lector_facturas:jobs:create',
      consumeRateLimit: false,
    });
    expect(insufficient).toMatchObject({ ok: false, status: 403 });
  });
});
