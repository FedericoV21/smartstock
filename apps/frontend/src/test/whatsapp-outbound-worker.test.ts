import { describe, expect, it, vi } from 'vitest';

const sendMocks = vi.hoisted(() => ({
  sendText: vi.fn(),
  sendDocument: vi.fn(),
}));

vi.mock('@/lib/whatsapp/send-message', () => ({
  sendWhatsAppTextMessage: (...args: any[]) => sendMocks.sendText(...args),
  sendWhatsAppDocumentMessage: (...args: any[]) => sendMocks.sendDocument(...args),
}));

import { processWhatsAppOutboundQueue } from '@/lib/whatsapp/outbound-worker';

type Row = Record<string, any>;
type Tables = Record<string, Row[]>;

class MockQueryBuilder implements PromiseLike<{ data: any; error: { message: string } | null }> {
  private selectedRows: Row[];
  private updatePayload: Row | null = null;
  private maybeSingleRequested = false;

  constructor(
    private tables: Tables,
    private table: string,
  ) {
    this.selectedRows = [...(this.tables[this.table] ?? [])];
  }

  select(): this {
    return this;
  }

  eq(column: string, value: unknown): this {
    this.selectedRows = this.selectedRows.filter((row) => row[column] === value);
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.selectedRows = this.selectedRows.filter((row) => values.includes(row[column]));
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    const ascending = options?.ascending ?? true;
    this.selectedRows = [...this.selectedRows].sort((a, b) => {
      const av = a[column] == null ? '' : String(a[column]);
      const bv = b[column] == null ? '' : String(b[column]);
      return ascending ? av.localeCompare(bv) : bv.localeCompare(av);
    });
    return this;
  }

  limit(count: number): this {
    this.selectedRows = this.selectedRows.slice(0, count);
    return this;
  }

  update(payload: Row): this {
    this.updatePayload = payload;
    return this;
  }

  maybeSingle() {
    this.maybeSingleRequested = true;
    return this.execute();
  }

  insert(payload: Row | Row[]): this {
    const rows = Array.isArray(payload) ? payload : [payload];
    this.tables[this.table] = this.tables[this.table] ?? [];
    this.tables[this.table].push(...rows);
    this.selectedRows = rows;
    return this;
  }

  then<TResult1 = { data: any; error: { message: string } | null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: any; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<{ data: any; error: { message: string } | null }> {
    if (this.updatePayload) {
      for (const row of this.selectedRows) Object.assign(row, this.updatePayload);
      return {
        data: this.maybeSingleRequested ? this.selectedRows[0] ?? null : this.selectedRows,
        error: null,
      };
    }

    return {
      data: this.maybeSingleRequested ? this.selectedRows[0] ?? null : this.selectedRows,
      error: null,
    };
  }
}

function createMockDb(tables: Tables) {
  return {
    from(table: string) {
      return new MockQueryBuilder(tables, table);
    },
  };
}

describe('processWhatsAppOutboundQueue', () => {
  it('can flush only the newly queued outbound message', async () => {
    sendMocks.sendText.mockResolvedValue({
      externalMessageId: 'wamid-new',
      resolvedToWaId: '5491111111111',
      raw: {},
    });

    const tables: Tables = {
      whatsapp_outbound_message: [
        {
          id: 'old-message',
          tenant_id: 'tenant-1',
          to_wa_id: '5491111111111',
          phone_number_id: 'phone-1',
          body: 'respuesta vieja',
          message_type: 'text',
          status: 'queued',
          retry_count: 0,
          related_job_id: null,
          created_at: '2026-05-22T10:00:00.000Z',
        },
        {
          id: 'new-message',
          tenant_id: 'tenant-1',
          to_wa_id: '5491111111111',
          phone_number_id: 'phone-1',
          body: 'respuesta nueva',
          message_type: 'text',
          status: 'queued',
          retry_count: 0,
          related_job_id: null,
          created_at: '2026-05-22T10:01:00.000Z',
        },
      ],
      whatsapp_job_event: [],
    };

    const stats = await processWhatsAppOutboundQueue({
      db: createMockDb(tables),
      tenantId: 'tenant-1',
      messageIds: ['new-message'],
      limit: 20,
    });

    expect(stats).toEqual({ processed: 1, sent: 1, failed: 0 });
    expect(sendMocks.sendText).toHaveBeenCalledTimes(1);
    expect(sendMocks.sendText).toHaveBeenCalledWith({
      phoneNumberId: 'phone-1',
      toWaId: '5491111111111',
      body: 'respuesta nueva',
    });
    expect(tables.whatsapp_outbound_message[0].status).toBe('queued');
    expect(tables.whatsapp_outbound_message[1]).toMatchObject({
      status: 'sent',
      external_message_id: 'wamid-new',
    });
  });
});
