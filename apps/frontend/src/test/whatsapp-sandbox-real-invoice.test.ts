import { createHash } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  aplicarConfirmacion: vi.fn(),
  prepararConfirmacion: vi.fn(),
}));

vi.mock('@/lib/lector-facturas/confirmacion-chatbot', () => ({
  aplicarConfirmacionLectorFacturaJob: (...args: any[]) => mocks.aplicarConfirmacion(...args),
  prepararConfirmacionLectorFacturaDesdeResultado: (...args: any[]) => mocks.prepararConfirmacion(...args),
  resumenAplicacionLectorFactura: (params: { comprobanteId: string }) =>
    `Factura cargada. Comprobante: ${params.comprobanteId}.`,
}));

type Row = Record<string, any>;
type Tables = Record<string, Row[]>;

const TENANT_ID = 'tenant-sandbox';
const USER_ID = 'user-sandbox';
const ACTOR_ID = 'actor-sandbox';
const FROM_WA_ID = `sandbox:${TENANT_ID}:${USER_ID}`;

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
      id: row.id ?? `${this.table}-${(this.tables[this.table] ?? []).length}`,
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

  upsert(payload: Row, options?: { onConflict?: string }): this {
    const conflictKey = options?.onConflict;
    this.tables[this.table] = this.tables[this.table] ?? [];
    const existing = conflictKey
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
    if (this.singleRequested) return { data: this.selectedRows[0] ?? null, error: null };
    if (this.maybeSingleRequested) return { data: this.selectedRows[0] ?? null, error: null };
    return { data: this.selectedRows, error: null };
  }
}

function createMockDb() {
  const tables: Tables = {
    whatsapp_actor: [
      {
        id: ACTOR_ID,
        tenant_id: TENANT_ID,
        usuario_id: USER_ID,
        from_wa_id: FROM_WA_ID,
        rol_whatsapp: 'admin',
        trust_level: 'verified',
        activo: true,
        verified_at: new Date().toISOString(),
      },
    ],
    whatsapp_action_log: [],
    whatsapp_sandbox_message: [],
    whatsapp_sandbox_invoice_ticket: [],
    whatsapp_sandbox_pending_action: [],
    whatsapp_conversation_state: [],
    whatsapp_agent_feature_flag: [
      { tenant_id: TENANT_ID, enabled: true, rollout_stage: 'v2', notes: null },
    ],
    whatsapp_outbound_message: [],
    modulo_config: [{ tenant_id: TENANT_ID, stock: true, facturador_simple: true }],
    proveedor: [{ id: 'prov-arcor', tenant_id: TENANT_ID, nombre: 'Arcor' }],
    producto: [
      {
        id: 'prod-alfajor',
        tenant_id: TENANT_ID,
        activo: true,
        codigo: 'ALF',
        nombre: 'Alfajor Jorgito',
        precio_costo: 50,
        unidad: 'unidad',
      },
    ],
    lector_factura_job: [
      {
        id: 'job-1',
        tenant_id: TENANT_ID,
        sucursal_id: 'suc-1',
        usuario_id: USER_ID,
        status: 'completed',
        resultado: { log_id: 'log-1', items: [], cabecera: {} },
        application_status: 'pending',
        applied_comprobante_id: null,
      },
    ],
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
    },
  };
}

let sendWhatsAppSandboxChatMessage: typeof import('@/lib/whatsapp/sandbox').sendWhatsAppSandboxChatMessage;
let handleWhatsAppTextMessage: typeof import('@/lib/whatsapp/text-handler').handleWhatsAppTextMessage;

describe('whatsapp sandbox real invoice confirmations', () => {
  beforeAll(async () => {
    vi.resetModules();
    const sandbox = await import('@/lib/whatsapp/sandbox');
    const textHandler = await import('@/lib/whatsapp/text-handler');
    sendWhatsAppSandboxChatMessage = sandbox.sendWhatsAppSandboxChatMessage;
    handleWhatsAppTextMessage = textHandler.handleWhatsAppTextMessage;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prepararConfirmacion.mockResolvedValue({
      impacto: {
        resumen: {
          proveedor_nombre: 'Proveedor SA',
          total_items: 1,
          productos_vinculados: 1,
          productos_nuevos: 0,
          productos_para_revisar: 0,
          total: 100,
          afecta_stock: true,
          afecta_cuenta_corriente: true,
          actualizar_costos: true,
        },
        cambios_costos: [],
        advertencias: [],
        conflictos: [],
        bloqueantes: [],
        requiere_confirmacion: true,
      },
      impactHash: 'hash-1',
      confirmPayload: { log_id: 'log-1' },
    });
    mocks.aplicarConfirmacion.mockResolvedValue({
      ok: true,
      comprobante_id: 'comp-1',
      actualizaciones_costos: [],
      idempotent_replay: false,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('executes a pending real invoice confirmation from the sandbox chat', async () => {
    const { db, tables, rpcCalls } = createMockDb();
    tables.whatsapp_action_log.push({
      id: 'action-1',
      tenant_id: TENANT_ID,
      actor_id: ACTOR_ID,
      from_wa_id: FROM_WA_ID,
      action_type: 'lector_factura_confirmar_importado',
      action_status: 'pending_confirmation',
      action_signature: 'invoice-signature',
      confirmation_token: '2468',
      confirmation_expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      action_payload: {
        lector_factura_job_id: 'job-1',
        impact_hash: 'hash-1',
      },
      created_at: new Date().toISOString(),
    });

    const result = await sendWhatsAppSandboxChatMessage({
      db,
      tenantId: TENANT_ID,
      userId: USER_ID,
      role: 'admin',
      content: 'OK 2468',
    });

    expect(mocks.aplicarConfirmacion).toHaveBeenCalledWith(expect.objectContaining({
      acceptedImpactHash: 'hash-1',
      tenantId: TENANT_ID,
    }));
    expect(tables.whatsapp_action_log[0].action_status).toBe('executed');
    expect(tables.whatsapp_action_log[0].inbound_message_id).toBeUndefined();
    expect(result.messages.at(-1)?.content).toContain('Factura cargada');
    expect(rpcCalls).toHaveLength(0);
  });

  it('keeps non-invoice sandbox actions simulated', async () => {
    const { db, tables, rpcCalls } = createMockDb();

    await sendWhatsAppSandboxChatMessage({
      db,
      tenantId: TENANT_ID,
      userId: USER_ID,
      role: 'admin',
      content: 'registrar pago proveedor arcor 1000',
    });

    expect(tables.whatsapp_action_log).toHaveLength(0);
    expect(tables.whatsapp_sandbox_pending_action).toHaveLength(1);
    const token = tables.whatsapp_sandbox_pending_action[0].confirmation_token;

    const confirmed = await sendWhatsAppSandboxChatMessage({
      db,
      tenantId: TENANT_ID,
      userId: USER_ID,
      role: 'admin',
      content: `SI ${token}`,
    });

    expect(tables.whatsapp_sandbox_pending_action[0].status).toBe('simulated');
    expect(confirmed.messages.some((message) => message.content.includes('No se modificaron datos'))).toBe(true);
    expect(rpcCalls).toHaveLength(0);
  });

  it('uses the active invoice ticket memory when the user says cargar', async () => {
    const { db, tables } = createMockDb();
    const signature = createHash('sha256')
      .update(`lector_factura_confirmar_importado|${TENANT_ID}|job-1|hash-1`)
      .digest('hex');
    tables.whatsapp_action_log.push({
      id: 'action-ticket',
      tenant_id: TENANT_ID,
      actor_id: ACTOR_ID,
      from_wa_id: FROM_WA_ID,
      action_type: 'lector_factura_confirmar_importado',
      action_status: 'pending_confirmation',
      action_signature: signature,
      confirmation_token: '1357',
      confirmation_expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      action_payload: {
        lector_factura_job_id: 'job-1',
        impact_hash: 'hash-1',
      },
      created_at: new Date().toISOString(),
    });
    tables.whatsapp_sandbox_invoice_ticket.push({
      id: 'ticket-1',
      tenant_id: TENANT_ID,
      usuario_id: USER_ID,
      actor_id: ACTOR_ID,
      from_wa_id: FROM_WA_ID,
      lector_factura_job_id: 'job-1',
      action_log_id: 'action-ticket',
      status: 'ready',
      summary: {
        proveedor_nombre: 'Proveedor SA',
        total: 100,
        items_count: 1,
        productos_vinculados: 1,
        productos_pendientes: 0,
        productos_nuevos: 0,
        productos_para_revisar: 0,
        afecta_stock: true,
        afecta_cuenta_corriente: true,
        actualizar_costos: true,
        cambios_costos: [],
        advertencias: [],
        conflictos: [],
        bloqueantes: [],
        impact_hash: 'hash-1',
        can_apply: true,
      },
      pending_items: [],
      impact_hash: 'hash-1',
      created_at: new Date().toISOString(),
    });

    const result = await sendWhatsAppSandboxChatMessage({
      db,
      tenantId: TENANT_ID,
      userId: USER_ID,
      role: 'admin',
      content: 'cargar',
    });

    expect(mocks.aplicarConfirmacion).toHaveBeenCalledWith(expect.objectContaining({
      acceptedImpactHash: 'hash-1',
      tenantId: TENANT_ID,
    }));
    expect(tables.whatsapp_action_log[0].action_status).toBe('executed');
    expect(tables.whatsapp_sandbox_invoice_ticket[0].status).toBe('applied');
    expect(result.messages.at(-1)?.content).toContain('Factura cargada');
  });

  it('lets the user review, search and link pending products by chat', async () => {
    const { db, tables } = createMockDb();
    tables.lector_factura_job[0].resultado = {
      log_id: 'log-1',
      cabecera: {
        tipo_comprobante: 'factura_a',
        letra: 'A',
        punto_venta: 1,
        numero: 44,
        fecha_emision: '2026-05-16',
      },
      proveedor: { id: 'prov-arcor', nombre: 'Arcor' },
      crear_proveedor: null,
      emisor: { razon_social: 'Arcor', cuit: '30711111119' },
      items: [
        {
          indice: 0,
          codigo: 'ALF',
          descripcion: 'Alfajor factura',
          cantidad: 3,
          unidad: 'unidad',
          precio_unitario: 100,
          subtotal: 300,
          iva_porcentaje: 21,
          match: {
            producto_id: null,
            confidence: 0,
            metodo: 'sin_match',
            producto_nombre: null,
            requires_review: true,
          },
        },
      ],
      totales: { total: 363 },
    };
    tables.whatsapp_sandbox_invoice_ticket.push({
      id: 'ticket-review',
      tenant_id: TENANT_ID,
      usuario_id: USER_ID,
      actor_id: ACTOR_ID,
      from_wa_id: FROM_WA_ID,
      lector_factura_job_id: 'job-1',
      action_log_id: null,
      status: 'needs_review',
      summary: {
        proveedor_nombre: 'Arcor',
        total: 363,
        items_count: 1,
        productos_vinculados: 0,
        productos_pendientes: 1,
        productos_nuevos: 1,
        productos_para_revisar: 1,
        afecta_stock: true,
        afecta_cuenta_corriente: true,
        actualizar_costos: true,
        cambios_costos: [],
        advertencias: [],
        conflictos: ['1 producto(s) requieren revision de match.'],
        bloqueantes: ['1 producto(s) pendientes de enlazar o revisar.'],
        impact_hash: 'hash-pending',
        can_apply: false,
      },
      pending_items: [
        {
          indice: 0,
          descripcion: 'Alfajor factura',
          codigo: 'ALF',
          cantidad: 3,
          precio_unitario: 100,
          subtotal: 300,
          producto_id: null,
          producto_nombre: null,
          confidence: 0,
          motivo: 'sin_producto',
        },
      ],
      chat_state: {},
      impact_hash: 'hash-pending',
      created_at: new Date().toISOString(),
    });

    const pending = await sendWhatsAppSandboxChatMessage({
      db,
      tenantId: TENANT_ID,
      userId: USER_ID,
      role: 'admin',
      content: 'pendientes',
    });
    expect(pending.messages.at(-1)?.content).toContain('buscar 1 texto del producto');

    const searched = await sendWhatsAppSandboxChatMessage({
      db,
      tenantId: TENANT_ID,
      userId: USER_ID,
      role: 'admin',
      content: 'buscar 1 Alfajor',
    });
    expect(searched.messages.at(-1)?.content).toContain('1. Alfajor Jorgito');
    expect(tables.whatsapp_sandbox_invoice_ticket[0].chat_state.last_product_search.results[0]).toMatchObject({
      producto_id: 'prod-alfajor',
      option: 1,
    });

    const linked = await sendWhatsAppSandboxChatMessage({
      db,
      tenantId: TENANT_ID,
      userId: USER_ID,
      role: 'admin',
      content: 'enlazar 1 1',
    });

    expect(tables.lector_factura_job[0].resultado.items[0].match).toMatchObject({
      producto_id: 'prod-alfajor',
      metodo: 'manual_ticket',
      requires_review: false,
    });
    expect(tables.whatsapp_sandbox_invoice_ticket[0].status).toBe('ready');
    expect(tables.whatsapp_sandbox_invoice_ticket[0].pending_items).toEqual([]);
    expect(tables.whatsapp_action_log).toHaveLength(1);
    expect(linked.messages.at(-1)?.content).toContain('Para cargarla');
  });

  it('uses the same invoice ticket conversation from the live WhatsApp text handler', async () => {
    vi.stubEnv('WHATSAPP_AUTO_FLUSH_OUTBOUND', '0');
    const { db, tables } = createMockDb();
    tables.lector_factura_job[0].resultado = {
      log_id: 'log-1',
      cabecera: {
        tipo_comprobante: 'factura_a',
        letra: 'A',
        punto_venta: 1,
        numero: 44,
        fecha_emision: '2026-05-16',
      },
      proveedor: { id: 'prov-arcor', nombre: 'Arcor' },
      crear_proveedor: null,
      emisor: { razon_social: 'Arcor', cuit: '30711111119' },
      items: [
        {
          indice: 0,
          codigo: 'ALF',
          descripcion: 'Alfajor factura',
          cantidad: 3,
          unidad: 'unidad',
          precio_unitario: 100,
          subtotal: 300,
          iva_porcentaje: 21,
          match: {
            producto_id: null,
            confidence: 0,
            metodo: 'sin_match',
            producto_nombre: null,
            requires_review: true,
          },
        },
      ],
      totales: { total: 363 },
    };
    tables.whatsapp_sandbox_invoice_ticket.push({
      id: 'ticket-live',
      tenant_id: TENANT_ID,
      usuario_id: USER_ID,
      actor_id: ACTOR_ID,
      from_wa_id: FROM_WA_ID,
      lector_factura_job_id: 'job-1',
      action_log_id: null,
      status: 'needs_review',
      summary: {
        proveedor_nombre: 'Arcor',
        total: 363,
        items_count: 1,
        productos_vinculados: 0,
        productos_pendientes: 1,
        productos_nuevos: 1,
        productos_para_revisar: 1,
        afecta_stock: true,
        afecta_cuenta_corriente: true,
        actualizar_costos: true,
        cambios_costos: [],
        advertencias: [],
        conflictos: ['1 producto(s) requieren revision de match.'],
        bloqueantes: ['1 producto(s) pendientes de enlazar o revisar.'],
        impact_hash: 'hash-pending',
        can_apply: false,
      },
      pending_items: [
        {
          indice: 0,
          descripcion: 'Alfajor factura',
          codigo: 'ALF',
          cantidad: 3,
          precio_unitario: 100,
          subtotal: 300,
          producto_id: null,
          producto_nombre: null,
          confidence: 0,
          motivo: 'sin_producto',
        },
      ],
      chat_state: {},
      impact_hash: 'hash-pending',
      created_at: new Date().toISOString(),
    });

    await handleWhatsAppTextMessage({
      db,
      tenantId: TENANT_ID,
      fromWaId: FROM_WA_ID,
      phoneNumberId: 'phone-1',
      inboundMessageId: 'inbound-live-1',
      wamid: 'wamid-live-1',
      textBody: 'pendientes',
      source: 'webhook_text',
    });
    expect(tables.whatsapp_outbound_message.at(-1)?.body).toContain('buscar 1 texto del producto');

    await handleWhatsAppTextMessage({
      db,
      tenantId: TENANT_ID,
      fromWaId: FROM_WA_ID,
      phoneNumberId: 'phone-1',
      inboundMessageId: 'inbound-live-2',
      wamid: 'wamid-live-2',
      textBody: 'buscar 1 Alfajor',
      source: 'webhook_text',
    });
    expect(tables.whatsapp_outbound_message.at(-1)?.body).toContain('1. Alfajor Jorgito');

    await handleWhatsAppTextMessage({
      db,
      tenantId: TENANT_ID,
      fromWaId: FROM_WA_ID,
      phoneNumberId: 'phone-1',
      inboundMessageId: 'inbound-live-3',
      wamid: 'wamid-live-3',
      textBody: 'enlazar 1 1',
      source: 'webhook_text',
    });

    expect(tables.lector_factura_job[0].resultado.items[0].match).toMatchObject({
      producto_id: 'prod-alfajor',
      metodo: 'manual_ticket',
      requires_review: false,
    });
    expect(tables.whatsapp_sandbox_invoice_ticket[0].status).toBe('ready');
    expect(tables.whatsapp_action_log).toHaveLength(1);
    expect(tables.whatsapp_outbound_message.at(-1)?.body).toContain('Para cargarla');

    const token = String(tables.whatsapp_action_log[0].confirmation_token);
    mocks.aplicarConfirmacion.mockClear();

    await handleWhatsAppTextMessage({
      db,
      tenantId: TENANT_ID,
      fromWaId: FROM_WA_ID,
      phoneNumberId: 'phone-1',
      inboundMessageId: 'inbound-live-4',
      wamid: 'wamid-live-4',
      textBody: `SI ${token}`,
      source: 'webhook_text',
    });

    expect(mocks.aplicarConfirmacion).toHaveBeenCalledWith(
      expect.objectContaining({
        acceptedImpactHash: 'hash-1',
        tenantId: TENANT_ID,
      }),
    );
    expect(tables.whatsapp_sandbox_invoice_ticket[0].status).toBe('applied');
    expect(tables.whatsapp_action_log[0].action_status).toBe('executed');
    expect(tables.whatsapp_outbound_message.at(-1)?.body).toContain('Factura cargada');
  });

  it('denies invoice confirm commands on live WhatsApp for readonly actors', async () => {
    vi.stubEnv('WHATSAPP_AUTO_FLUSH_OUTBOUND', '0');
    const { db, tables } = createMockDb();
    tables.whatsapp_actor[0].rol_whatsapp = 'readonly';
    tables.whatsapp_sandbox_invoice_ticket.push({
      id: 'ticket-readonly-live',
      tenant_id: TENANT_ID,
      usuario_id: USER_ID,
      actor_id: ACTOR_ID,
      from_wa_id: FROM_WA_ID,
      lector_factura_job_id: 'job-1',
      action_log_id: 'action-readonly',
      status: 'ready',
      summary: {
        proveedor_nombre: 'Arcor',
        total: 363,
        items_count: 1,
        productos_vinculados: 1,
        productos_pendientes: 0,
        productos_nuevos: 0,
        productos_para_revisar: 0,
        afecta_stock: true,
        afecta_cuenta_corriente: true,
        actualizar_costos: true,
        cambios_costos: [],
        advertencias: [],
        conflictos: [],
        bloqueantes: [],
        impact_hash: 'hash-ready',
        can_apply: true,
      },
      pending_items: [],
      impact_hash: 'hash-ready',
      created_at: new Date().toISOString(),
    });
    tables.whatsapp_action_log.push({
      id: 'action-readonly',
      tenant_id: TENANT_ID,
      actor_id: ACTOR_ID,
      from_wa_id: FROM_WA_ID,
      action_type: 'lector_factura_confirmar_importado',
      action_status: 'pending_confirmation',
      action_signature: 'sig-readonly',
      confirmation_token: '9999',
      confirmation_expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      action_payload: {
        lector_factura_job_id: 'job-1',
        impact_hash: 'hash-ready',
      },
      created_at: new Date().toISOString(),
    });

    await handleWhatsAppTextMessage({
      db,
      tenantId: TENANT_ID,
      fromWaId: FROM_WA_ID,
      phoneNumberId: 'phone-1',
      inboundMessageId: 'inbound-readonly-1',
      wamid: 'wamid-readonly-1',
      textBody: 'cargar',
      source: 'webhook_text',
    });

    expect(mocks.aplicarConfirmacion).not.toHaveBeenCalled();
    expect(tables.whatsapp_outbound_message.at(-1)?.body).toContain('solo lectura');
  });
});
