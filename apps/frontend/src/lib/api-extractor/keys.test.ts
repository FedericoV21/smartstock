import { describe, expect, it } from 'vitest';

import {
  authenticateExtractorKey,
  hashExtractorApiKey,
  previewExtractorApiKey,
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

function createDb(key: Row) {
  const tables: Record<string, Row[]> = {
    api_extractor_key: [key],
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
  return new Request('https://example.com/api/public/invoice-extractor/extract', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe('extractor api keys', () => {
  it('hashea y previsualiza el token sin guardar el valor plano', () => {
    expect(hashExtractorApiKey('secret-token')).toBe(hashExtractorApiKey('secret-token'));
    expect(hashExtractorApiKey('secret-token')).not.toBe('secret-token');
    expect(previewExtractorApiKey('abcdef123456')).toBe('abcd...3456');
  });

  it('autentica una key activa con scope invoice:extract', async () => {
    const token = 'sex_test_123';
    const db = createDb({
      id: 'key-1',
      nombre: 'Extractor',
      key_hash: hashExtractorApiKey(token),
      scopes: ['invoice:extract'],
      estado: 'activa',
      rate_limit_por_minuto: 10,
    });

    const auth = await authenticateExtractorKey({
      db,
      request: requestWithToken(token),
      scope: 'invoice:extract',
      consumeRateLimit: false,
    });

    expect(auth.ok).toBe(true);
    if (!auth.ok) throw new Error(auth.error);
    expect(auth.key.id).toBe('key-1');
    expect(db.tables.api_extractor_key[0]?.last_used_at).toBeTruthy();
  });

  it('rechaza key invalida, revocada y sin scope', async () => {
    const token = 'sex_test_456';

    const invalid = await authenticateExtractorKey({
      db: createDb({
        id: 'key-1',
        nombre: 'Extractor',
        key_hash: hashExtractorApiKey('otra'),
        scopes: ['invoice:extract'],
        estado: 'activa',
        rate_limit_por_minuto: 10,
      }),
      request: requestWithToken(token),
      scope: 'invoice:extract',
      consumeRateLimit: false,
    });
    expect(invalid).toMatchObject({ ok: false, status: 401 });

    const revoked = await authenticateExtractorKey({
      db: createDb({
        id: 'key-2',
        nombre: 'Extractor',
        key_hash: hashExtractorApiKey(token),
        scopes: ['invoice:extract'],
        estado: 'revocada',
        rate_limit_por_minuto: 10,
      }),
      request: requestWithToken(token),
      scope: 'invoice:extract',
      consumeRateLimit: false,
    });
    expect(revoked).toMatchObject({ ok: false, status: 403 });

    const insufficient = await authenticateExtractorKey({
      db: createDb({
        id: 'key-3',
        nombre: 'Extractor',
        key_hash: hashExtractorApiKey(token),
        scopes: ['otro:scope'],
        estado: 'activa',
        rate_limit_por_minuto: 10,
      }),
      request: requestWithToken(token),
      scope: 'invoice:extract',
      consumeRateLimit: false,
    });
    expect(insufficient).toMatchObject({ ok: false, status: 403 });
  });

  it('aplica rate limit por key', async () => {
    const token = 'sex_test_rate';
    const db = createDb({
      id: 'key-rate',
      nombre: 'Extractor',
      key_hash: hashExtractorApiKey(token),
      scopes: ['invoice:extract'],
      estado: 'activa',
      rate_limit_por_minuto: 1,
    });

    const first = await authenticateExtractorKey({
      db,
      request: requestWithToken(token),
      scope: 'invoice:extract',
    });
    const second = await authenticateExtractorKey({
      db,
      request: requestWithToken(token),
      scope: 'invoice:extract',
    });

    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, status: 429 });
  });
});

