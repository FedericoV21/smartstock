import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { handleWhatsAppActionMessage } from '@/lib/whatsapp/action-handler';
import { sendWhatsAppSandboxChatMessage } from '@/lib/whatsapp/sandbox';

type Row = Record<string, any>;
type Tables = Record<string, Row[]>;

const TENANT_ID = 'tenant-sandbox';
const USER_ID = 'user-sandbox';

class MockQueryBuilder implements PromiseLike<{ data: any; error: { message: string } | null }> {
  private selectedRows: Row[];
  private insertedRows: Row[] | null = null;
  private updatePayload: Row | null = null;
  private deleteRequested = false;
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

  in(column: string, values: unknown[]): this {
    this.selectedRows = this.selectedRows.filter((row) => values.includes(row[column]));
    return this;
  }

  ilike(column: string, pattern: string): this {
    const needle = pattern.replace(/^%|%$/g, '').toLowerCase();
    this.selectedRows = this.selectedRows.filter((row) =>
      String(row[column] ?? '').toLowerCase().includes(needle),
    );
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

  insert(payload: Row | Row[]): this {
    const rows = (Array.isArray(payload) ? payload : [payload]).map((row) => ({
      id: row.id ?? `${this.table}-${this.tables[this.table]?.length ?? 0}-${Math.random()}`,
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

  delete(): this {
    this.deleteRequested = true;
    return this;
  }

  upsert(payload: Row, options?: { onConflict?: string }): this {
    const conflictKey = options?.onConflict;
    this.tables[this.table] = this.tables[this.table] ?? [];
    const existing =
      conflictKey != null
        ? this.tables[this.table].find((row) => row[conflictKey] === payload[conflictKey])
        : null;
    if (existing) {
      Object.assign(existing, payload);
      this.selectedRows = [existing];
    } else {
      this.insert(payload);
    }
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
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<{ data: any; error: { message: string } | null }> {
    if (this.updatePayload) {
      for (const row of this.selectedRows) Object.assign(row, this.updatePayload);
      return { data: this.singleRequested || this.maybeSingleRequested ? this.selectedRows[0] ?? null : this.selectedRows, error: null };
    }

    if (this.deleteRequested) {
      const toDelete = new Set(this.selectedRows);
      this.tables[this.table] = (this.tables[this.table] ?? []).filter((row) => !toDelete.has(row));
      return { data: null, error: null };
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

function createMockDb() {
  const tables: Tables = {
    whatsapp_actor: [],
    whatsapp_sandbox_message: [],
    whatsapp_sandbox_pending_action: [],
    whatsapp_conversation_state: [],
    whatsapp_outbound_message: [],
    whatsapp_agent_turn_log: [],
    modulo_config: [{ tenant_id: TENANT_ID, stock: true, facturador_simple: true }],
    proveedor: [{ id: 'prov-arcor', tenant_id: TENANT_ID, nombre: 'Arcor' }],
    cliente: [{ id: 'cli-juan', tenant_id: TENANT_ID, nombre: 'Juan Perez', razon_social: null }],
    producto: [
      {
        id: 'prd-coca-225',
        tenant_id: TENANT_ID,
        nombre: 'Coca Cola 2.25L',
        codigo: 'COC-225',
        stock_actual: 12,
        activo: true,
        sucursal_id: 'suc-1',
      },
      {
        id: 'prd-coca-15',
        tenant_id: TENANT_ID,
        nombre: 'Coca Cola 1.5L',
        codigo: 'COC-15',
        stock_actual: 7,
        activo: true,
        sucursal_id: 'suc-1',
      },
    ],
    stock_sucursal: [
      {
        tenant_id: TENANT_ID,
        producto_id: 'prd-coca-225',
        stock_actual: 12,
        stock_minimo: 5,
        sucursal: { codigo: 'CASA', nombre: 'Casa Central' },
        producto: { id: 'prd-coca-225', nombre: 'Coca Cola 2.25L', codigo: 'COC-225', activo: true },
      },
      {
        tenant_id: TENANT_ID,
        producto_id: 'prd-coca-15',
        stock_actual: 7,
        stock_minimo: 5,
        sucursal: { codigo: 'CASA', nombre: 'Casa Central' },
        producto: { id: 'prd-coca-15', nombre: 'Coca Cola 1.5L', codigo: 'COC-15', activo: true },
      },
    ],
    cuenta_corriente: [{ tenant_id: TENANT_ID, proveedor_id: 'prov-arcor', saldo: 1000 }],
  };
  const rpcCalls: string[] = [];

  return {
    tables,
    rpcCalls,
    db: {
      from(table: string) {
        return new MockQueryBuilder(tables, table);
      },
      async rpc(name: string) {
        rpcCalls.push(name);
        return { data: { ok: true }, error: null };
      },
      storage: {
        from() {
          return {
            async upload() {
              return { error: { message: 'storage disabled in sandbox test' } };
            },
            async createSignedUrl() {
              return { data: null, error: { message: 'storage disabled in sandbox test' } };
            },
          };
        },
      },
    },
  };
}

describe('whatsapp sandbox chat', () => {
  const originalLlmFlag = process.env.WHATSAPP_AGENT_INTENT_LLM;

  beforeAll(() => {
    process.env.WHATSAPP_AGENT_INTENT_LLM = 'false';
  });

  afterAll(() => {
    process.env.WHATSAPP_AGENT_INTENT_LLM = originalLlmFlag;
  });

  it('persiste historial de consulta read-only y no crea outbound real', async () => {
    const { db, tables } = createMockDb();

    const result = await sendWhatsAppSandboxChatMessage({
      db,
      tenantId: TENANT_ID,
      userId: USER_ID,
      role: 'admin',
      content: 'stock de coca',
    });

    expect(result.messages.some((message) => message.role === 'user')).toBe(true);
    expect(result.messages.some((message) => message.role === 'assistant')).toBe(true);
    expect(result.messages.map((message) => message.content).join('\n').toLowerCase()).toContain('varios productos');
    expect(tables.whatsapp_outbound_message).toHaveLength(0);
    expect(tables.whatsapp_conversation_state).toHaveLength(1);

    expect(tables.whatsapp_agent_turn_log).toHaveLength(1);
    const log = tables.whatsapp_agent_turn_log[0];
    expect(log).toMatchObject({
      tenant_id: TENANT_ID,
      channel: 'sandbox',
      source: 'sandbox_text',
      input_body: 'stock de coca',
      status: 'success',
      intent: 'stock_producto',
      tool_name: 'getProductStock',
    });
    expect(String(log.reply_body).toLowerCase()).toContain('varios productos');
    expect(log.tool_args).toMatchObject({ targetName: 'coca' });
    expect(log.tool_trace).toMatchObject({ name: 'getProductStock', status: 'success' });
  });

  it('registra fallback sin tool cuando no puede resolver la consulta', async () => {
    const { db, tables } = createMockDb();

    await sendWhatsAppSandboxChatMessage({
      db,
      tenantId: TENANT_ID,
      userId: USER_ID,
      role: 'admin',
      content: 'necesito una poesia sobre la luna',
    });

    expect(tables.whatsapp_agent_turn_log).toHaveLength(1);
    expect(tables.whatsapp_agent_turn_log[0]).toMatchObject({
      channel: 'sandbox',
      source: 'sandbox_text',
      status: 'fallback',
      tool_name: null,
    });
    expect(tables.whatsapp_agent_turn_log[0].fallback_reason).toBeTruthy();
  });

  it('usa la memoria del actor sintetico para resolver un follow-up', async () => {
    const { db } = createMockDb();

    const first = await sendWhatsAppSandboxChatMessage({
      db,
      tenantId: TENANT_ID,
      userId: USER_ID,
      role: 'admin',
      content: 'stock de coca',
    });
    expect(first.messages.at(-1)?.content.toLowerCase()).toContain('varios productos');

    const second = await sendWhatsAppSandboxChatMessage({
      db,
      tenantId: TENANT_ID,
      userId: USER_ID,
      role: 'admin',
      content: 'el primero',
    });

    expect(second.messages.at(-1)?.content.toLowerCase()).toContain('stock total de coca cola 2.25l');
  });

  it('simula acciones con confirmacion sin llamar RPCs reales', async () => {
    const { db, tables, rpcCalls } = createMockDb();
    const actor = { id: 'actor-1', usuario_id: USER_ID, rol_whatsapp: 'admin' };

    const pending = await handleWhatsAppActionMessage({
      db,
      tenantId: TENANT_ID,
      actor,
      fromWaId: 'sandbox:test',
      inboundMessageId: 'sandbox-inbound-1',
      wamid: 'sandbox-wamid-1',
      textBody: 'registrar pago proveedor arcor 1000',
      actionMode: 'simulate',
      sandboxUserId: USER_ID,
    });

    expect(pending.handled).toBe(true);
    expect(pending.handled ? pending.reply : '').toContain('Modo prueba');
    expect(tables.whatsapp_sandbox_pending_action).toHaveLength(1);
    expect(rpcCalls).toHaveLength(0);

    const token = tables.whatsapp_sandbox_pending_action[0].confirmation_token;
    const confirmed = await handleWhatsAppActionMessage({
      db,
      tenantId: TENANT_ID,
      actor,
      fromWaId: 'sandbox:test',
      inboundMessageId: 'sandbox-inbound-2',
      wamid: 'sandbox-wamid-2',
      textBody: `SI ${token}`,
      actionMode: 'simulate',
      sandboxUserId: USER_ID,
    });

    expect(confirmed.handled).toBe(true);
    expect(confirmed.handled ? confirmed.reply : '').toContain('No se modificaron datos');
    expect(tables.whatsapp_sandbox_pending_action[0].status).toBe('simulated');
    expect(rpcCalls).toHaveLength(0);
  });

  it('registra action payload y resultado cuando la accion pasa por el chatbot sandbox', async () => {
    const { db, tables } = createMockDb();

    await sendWhatsAppSandboxChatMessage({
      db,
      tenantId: TENANT_ID,
      userId: USER_ID,
      role: 'admin',
      content: 'registrar pago proveedor arcor 1000',
    });

    const pendingLog = tables.whatsapp_agent_turn_log.at(-1);
    expect(pendingLog).toMatchObject({
      channel: 'sandbox',
      intent: 'action_pending_confirmation_proveedor_pago',
      tool_name: 'registrar_pago_cuenta_proveedor',
      status: 'success',
    });
    expect(pendingLog?.tool_args).toMatchObject({
      proveedor_nombre: 'Arcor',
      monto: 1000,
    });
    expect(pendingLog?.processing_trace).toMatchObject({
      handled_by: 'action_agent',
      action_mode: 'simulate',
    });

    const token = tables.whatsapp_sandbox_pending_action[0].confirmation_token;
    await sendWhatsAppSandboxChatMessage({
      db,
      tenantId: TENANT_ID,
      userId: USER_ID,
      role: 'admin',
      content: `SI ${token}`,
    });

    const confirmedLog = tables.whatsapp_agent_turn_log.at(-1);
    expect(confirmedLog).toMatchObject({
      channel: 'sandbox',
      intent: 'action_executed_proveedor_pago_directo',
      tool_name: 'registrar_pago_cuenta_proveedor',
      status: 'success',
    });
    expect(confirmedLog?.tool_result).toMatchObject({
      simulated: true,
      tool: 'registrar_pago_cuenta_proveedor',
    });
  });

  it('cancela o vence confirmaciones simuladas sin ejecutar RPCs', async () => {
    const { db, tables, rpcCalls } = createMockDb();
    const actor = { id: 'actor-1', usuario_id: USER_ID, rol_whatsapp: 'admin' };

    tables.whatsapp_sandbox_pending_action.push({
      id: 'expired-action',
      tenant_id: TENANT_ID,
      usuario_id: USER_ID,
      actor_id: actor.id,
      from_wa_id: 'sandbox:test',
      action_type: 'proveedor_pago_directo',
      status: 'pending_confirmation',
      confirmation_token: '1234',
      confirmation_expires_at: new Date(Date.now() - 1000).toISOString(),
      action_payload: { proveedor_nombre: 'Arcor', monto: 1000 },
      action_signature: 'expired',
      created_at: new Date().toISOString(),
    });

    const expired = await handleWhatsAppActionMessage({
      db,
      tenantId: TENANT_ID,
      actor,
      fromWaId: 'sandbox:test',
      inboundMessageId: 'sandbox-inbound-3',
      wamid: 'sandbox-wamid-3',
      textBody: 'SI 1234',
      actionMode: 'simulate',
      sandboxUserId: USER_ID,
    });
    expect(expired.handled ? expired.telemetry.fallbackReason : '').toBe('confirmation_expired');
    expect(tables.whatsapp_sandbox_pending_action[0].status).toBe('cancelled');

    tables.whatsapp_sandbox_pending_action.push({
      id: 'cancel-action',
      tenant_id: TENANT_ID,
      usuario_id: USER_ID,
      actor_id: actor.id,
      from_wa_id: 'sandbox:test',
      action_type: 'proveedor_pago_directo',
      status: 'pending_confirmation',
      confirmation_token: '5678',
      confirmation_expires_at: new Date(Date.now() + 1000 * 60).toISOString(),
      action_payload: { proveedor_nombre: 'Arcor', monto: 1000 },
      action_signature: 'cancel',
      created_at: new Date().toISOString(),
    });

    const cancelled = await handleWhatsAppActionMessage({
      db,
      tenantId: TENANT_ID,
      actor,
      fromWaId: 'sandbox:test',
      inboundMessageId: 'sandbox-inbound-4',
      wamid: 'sandbox-wamid-4',
      textBody: 'cancelar',
      actionMode: 'simulate',
      sandboxUserId: USER_ID,
    });
    expect(cancelled.handled ? cancelled.telemetry.intent : '').toBe('action_cancelled');
    expect(tables.whatsapp_sandbox_pending_action[1].status).toBe('cancelled');
    expect(rpcCalls).toHaveLength(0);
  });

  it('acepta OK token para confirmar carga de factura IA en modo simulacion', async () => {
    const { db, tables, rpcCalls } = createMockDb();
    const actor = { id: 'actor-1', usuario_id: USER_ID, rol_whatsapp: 'admin' };

    tables.whatsapp_sandbox_pending_action.push({
      id: 'invoice-action',
      tenant_id: TENANT_ID,
      usuario_id: USER_ID,
      actor_id: actor.id,
      from_wa_id: 'sandbox:test',
      action_type: 'lector_factura_confirmar_importado',
      status: 'pending_confirmation',
      confirmation_token: '2468',
      confirmation_expires_at: new Date(Date.now() + 1000 * 60).toISOString(),
      action_payload: {
        lector_factura_job_id: 'job-1',
        impact_hash: 'hash-1',
      },
      action_signature: 'invoice',
      created_at: new Date().toISOString(),
    });

    const confirmed = await handleWhatsAppActionMessage({
      db,
      tenantId: TENANT_ID,
      actor,
      fromWaId: 'sandbox:test',
      inboundMessageId: 'sandbox-inbound-invoice',
      wamid: 'sandbox-wamid-invoice',
      textBody: 'OK 2468',
      actionMode: 'simulate',
      sandboxUserId: USER_ID,
    });

    expect(confirmed.handled).toBe(true);
    expect(confirmed.handled ? confirmed.reply : '').toContain('carga de factura IA');
    expect(tables.whatsapp_sandbox_pending_action[0].status).toBe('simulated');
    expect(rpcCalls).toHaveLength(0);
  });
});
