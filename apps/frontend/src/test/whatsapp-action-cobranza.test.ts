import { describe, expect, it } from 'vitest';

import { handleWhatsAppActionMessage } from '@/lib/whatsapp/action-handler';

type Row = Record<string, any>;
type Tables = Record<string, Row[]>;

const TENANT_ID = 'tenant-action-cobranza';
const USER_ID = 'user-action-cobranza';

class MockQueryBuilder implements PromiseLike<{ data: any; error: { message: string } | null }> {
  private selectedRows: Row[];
  private insertedRows: Row[] | null = null;
  private updatePayload: Row | null = null;
  private maybeSingleRequested = false;
  private singleRequested = false;

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

  or(expression: string): this {
    const clauses = expression
      .split(',')
      .map((part) => part.trim())
      .map((part) => part.match(/^([a-z0-9_]+)\.ilike\.\%(.*)\%$/i))
      .filter((match): match is RegExpMatchArray => Boolean(match));

    this.selectedRows = this.selectedRows.filter((row) =>
      clauses.some((match) => String(row[match[1]] ?? '').toLowerCase().includes(match[2].toLowerCase())),
    );
    return this;
  }

  order(): this {
    return this;
  }

  limit(count: number): this {
    this.selectedRows = this.selectedRows.slice(0, count);
    return this;
  }

  insert(payload: Row | Row[]): this {
    const rows = (Array.isArray(payload) ? payload : [payload]).map((row) => ({
      id: row.id ?? `${this.table}-${this.tables[this.table]?.length ?? 0}`,
      created_at: row.created_at ?? new Date().toISOString(),
      ...row,
    }));
    this.tables[this.table] = this.tables[this.table] ?? [];
    this.tables[this.table].push(...rows);
    this.insertedRows = rows;
    this.selectedRows = rows;
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

  single() {
    this.singleRequested = true;
    return this.execute();
  }

  then<TResult1 = { data: any; error: { message: string } | null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: any; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>)
      | null
      | undefined,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null | undefined,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<{ data: any; error: { message: string } | null }> {
    if (this.updatePayload) {
      for (const row of this.selectedRows) Object.assign(row, this.updatePayload);
      return {
        data: this.singleRequested || this.maybeSingleRequested ? this.selectedRows[0] ?? null : this.selectedRows,
        error: null,
      };
    }
    if (this.insertedRows) {
      if (this.singleRequested) return { data: this.insertedRows[0], error: null };
      if (this.maybeSingleRequested) return { data: this.insertedRows[0] ?? null, error: null };
      return { data: this.insertedRows, error: null };
    }
    if (this.singleRequested) {
      if (this.selectedRows.length !== 1) {
        return { data: null, error: { message: `Expected single row, got ${this.selectedRows.length}` } };
      }
      return { data: this.selectedRows[0], error: null };
    }
    if (this.maybeSingleRequested) return { data: this.selectedRows[0] ?? null, error: null };
    return { data: this.selectedRows, error: null };
  }
}

function createCobranzaActionDb() {
  const tables: Tables = {
    modulo_config: [{ tenant_id: TENANT_ID, stock: true, facturador_simple: true }],
    tenant: [{ id: TENANT_ID, punto_de_venta: 1 }],
    cliente: [{ id: 'cli-juan', tenant_id: TENANT_ID, nombre: 'Juan Perez', razon_social: null }],
    cobranza_factura: [
      {
        id: 'cf-42',
        cliente_id: 'cli-juan',
        saldo_pendiente: 8000,
        comprobante: {
          id: 'comp-42',
          tenant_id: TENANT_ID,
          tipo: 'factura_b',
          numero: 42,
          numero_caja: null,
          fecha: '2026-06-01',
          created_at: '2026-06-01T10:00:00.000Z',
        },
      },
    ],
    whatsapp_sandbox_pending_action: [],
  };
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  return {
    tables,
    rpcCalls,
    db: {
      from(table: string) {
        return new MockQueryBuilder(tables, table);
      },
      async rpc(name: string, args: Record<string, unknown>) {
        rpcCalls.push({ name, args });
        return { data: { nuevo_saldo: 3000, cobranza_pago_id: 'pay-1' }, error: null };
      },
    },
  };
}

describe('whatsapp action cobranza por factura', () => {
  it('simula cobro por factura con confirmacion y llama registrar_pago_cobranza al confirmar', async () => {
    const { db, tables, rpcCalls } = createCobranzaActionDb();
    const actor = { id: 'actor-1', usuario_id: USER_ID, rol_whatsapp: 'operador' };

    const pending = await handleWhatsAppActionMessage({
      db,
      tenantId: TENANT_ID,
      actor,
      fromWaId: 'sandbox:cobranza',
      inboundMessageId: 'inbound-1',
      wamid: 'wamid-1',
      textBody: 'cobrar factura 42 cliente Juan Perez 5000',
      actionMode: 'simulate',
      sandboxUserId: USER_ID,
    });

    expect(pending.handled).toBe(true);
    expect(pending.handled ? pending.telemetry.tool : null).toBe('registrar_pago_cobranza');
    expect(pending.handled ? pending.telemetry.intent : '').toBe(
      'action_pending_confirmation_cliente_cobro_factura',
    );
    expect(tables.whatsapp_sandbox_pending_action).toHaveLength(1);
    expect(tables.whatsapp_sandbox_pending_action[0].action_type).toBe('cliente_cobro_factura');
    expect(rpcCalls).toHaveLength(0);

    const token = tables.whatsapp_sandbox_pending_action[0].confirmation_token;
    const confirmed = await handleWhatsAppActionMessage({
      db,
      tenantId: TENANT_ID,
      actor,
      fromWaId: 'sandbox:cobranza',
      inboundMessageId: 'inbound-2',
      wamid: 'wamid-2',
      textBody: `SI ${token}`,
      actionMode: 'simulate',
      sandboxUserId: USER_ID,
    });

    expect(confirmed.handled).toBe(true);
    expect(confirmed.handled ? confirmed.reply : '').toContain('Simulacion validada');
    expect(confirmed.handled ? confirmed.reply : '').toContain('Factura B');
    expect(rpcCalls).toHaveLength(0);
    expect(tables.whatsapp_sandbox_pending_action[0].status).toBe('simulated');
  });

  it('ejecuta registrar_pago_cobranza en modo live tras confirmar', async () => {
    const { db, tables, rpcCalls } = createCobranzaActionDb();
    tables.whatsapp_action_log = [];
    const actor = { id: 'actor-1', usuario_id: USER_ID, rol_whatsapp: 'operador' };

    const pending = await handleWhatsAppActionMessage({
      db,
      tenantId: TENANT_ID,
      actor,
      fromWaId: 'wa:cobranza',
      inboundMessageId: '00000000-0000-4000-8000-000000000001',
      wamid: 'wamid-live-1',
      textBody: 'cobrar factura 42 cliente Juan Perez 5000',
      actionMode: 'execute',
    });

    expect(pending.handled).toBe(true);
    expect(tables.whatsapp_action_log).toHaveLength(1);
    expect(rpcCalls).toHaveLength(0);

    const token = tables.whatsapp_action_log[0].confirmation_token;
    const confirmed = await handleWhatsAppActionMessage({
      db,
      tenantId: TENANT_ID,
      actor,
      fromWaId: 'wa:cobranza',
      inboundMessageId: '00000000-0000-4000-8000-000000000002',
      wamid: 'wamid-live-2',
      textBody: `SI ${token}`,
      actionMode: 'execute',
    });

    expect(confirmed.handled).toBe(true);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].name).toBe('registrar_pago_cobranza');
    expect(rpcCalls[0].args.p_cobranza_factura_id).toBe('cf-42');
    expect(rpcCalls[0].args.p_monto).toBe(5000);
    expect(confirmed.handled ? confirmed.reply : '').toContain('Cobro registrado');
  });
});
