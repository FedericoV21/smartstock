import { describe, expect, it } from 'vitest';

import { buscarJobIdempotente, parseJobArchivos } from './jobs';

type Row = Record<string, any>;

class MockQuery implements PromiseLike<{ data: any; error: any }> {
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

  then<TResult1 = { data: any; error: any }, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: this.rows, error: null }).then(onfulfilled, onrejected);
  }
}

describe('lector factura jobs async', () => {
  it('normaliza archivos validos y descarta filas incompletas', () => {
    const archivos = parseJobArchivos([
      {
        nombre: 'factura.pdf',
        mimeType: 'application/pdf',
        size: 123,
        storageBucket: 'facturas-recibidas',
        storagePath: 'tenant/job/factura.pdf',
      },
      { nombre: 'sin-path.pdf', mimeType: 'application/pdf' },
    ]);

    expect(archivos).toEqual([
      {
        nombre: 'factura.pdf',
        mimeType: 'application/pdf',
        size: 123,
        storageBucket: 'facturas-recibidas',
        storagePath: 'tenant/job/factura.pdf',
      },
    ]);
  });

  it('recupera un job por idempotency_key de la misma API key', async () => {
    const db = {
      from() {
        return new MockQuery([
          {
            id: 'job-1',
            tenant_id: 'tenant-1',
            api_key_id: 'key-1',
            idempotency_key: 'idem-1',
            status: 'queued',
          },
          {
            id: 'job-2',
            tenant_id: 'tenant-1',
            api_key_id: 'key-2',
            idempotency_key: 'idem-1',
            status: 'completed',
          },
        ]);
      },
    };

    const job = await buscarJobIdempotente({
      db,
      tenantId: 'tenant-1',
      apiKeyId: 'key-1',
      idempotencyKey: 'idem-1',
    });

    expect(job).toMatchObject({ id: 'job-1', status: 'queued' });
  });
});
