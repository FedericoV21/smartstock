import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  procesarFacturaIa: vi.fn(),
  validarArchivosFacturaIa: vi.fn(),
  prepararConfirmacion: vi.fn(),
}));

vi.mock('@/lib/lector-facturas/procesar-factura-ia', () => ({
  procesarFacturaIa: (...args: any[]) => mocks.procesarFacturaIa(...args),
  validarArchivosFacturaIa: (...args: any[]) => mocks.validarArchivosFacturaIa(...args),
}));

vi.mock('@/lib/lector-facturas/confirmacion-chatbot', () => ({
  prepararConfirmacionLectorFacturaDesdeResultado: (...args: any[]) => mocks.prepararConfirmacion(...args),
  resumenImpactoLectorFactura: (_impacto: unknown, impactHash: string, token?: string) =>
    `Resumen impacto ${impactHash}${token ? ` token ${token}` : ''}`,
}));

import { processWhatsAppSandboxInvoiceUpload } from '@/lib/whatsapp/sandbox-invoice';

type Row = Record<string, any>;
type Tables = Record<string, Row[]>;

const TENANT_ID = 'tenant-sandbox';
const USER_ID = 'user-sandbox';

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
    whatsapp_actor: [],
    whatsapp_action_log: [],
    whatsapp_sandbox_message: [],
    lector_factura_job: [],
  };
  return {
    tables,
    db: {
      from(table: string) {
        return new MockQueryBuilder(tables, table);
      },
    },
  };
}

describe('processWhatsAppSandboxInvoiceUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validarArchivosFacturaIa.mockReturnValue({ ok: true, totalBytes: 12 });
    mocks.procesarFacturaIa.mockResolvedValue({
      ok: true,
      payload: {
        log_id: 'log-1',
        multipagina: {
          archivos: [
            {
              nombre: 'factura.pdf',
              mimeType: 'application/pdf',
              size: 12,
              storagePath: 'tenant/lector/factura.pdf',
            },
          ],
        },
      },
    });
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
  });

  it('creates a completed lector job and a real pending invoice action', async () => {
    const { db, tables } = createMockDb();
    const result = await processWhatsAppSandboxInvoiceUpload({
      db,
      tenantId: TENANT_ID,
      userId: USER_ID,
      role: 'admin',
      sucursalId: 'suc-1',
      archivos: [
        {
          name: 'factura.pdf',
          type: 'application/pdf',
          size: 12,
          bytes: new Uint8Array([1, 2, 3]),
        },
      ],
    });

    if (!result.ok) throw new Error(result.error);
    expect(mocks.procesarFacturaIa).toHaveBeenCalledWith(expect.objectContaining({
      source: 'whatsapp',
      tenantId: TENANT_ID,
      userId: USER_ID,
    }));
    expect(tables.lector_factura_job).toHaveLength(1);
    expect(tables.lector_factura_job[0]).toMatchObject({
      tenant_id: TENANT_ID,
      sucursal_id: 'suc-1',
      usuario_id: USER_ID,
      status: 'completed',
      lector_factura_log_id: 'log-1',
      impact_hash: 'hash-1',
      application_status: 'pending',
    });
    expect(tables.whatsapp_action_log).toHaveLength(1);
    expect(tables.whatsapp_action_log[0]).toMatchObject({
      tenant_id: TENANT_ID,
      action_type: 'lector_factura_confirmar_importado',
      action_status: 'pending_confirmation',
    });
    expect(tables.whatsapp_sandbox_invoice_ticket).toHaveLength(1);
    expect(tables.whatsapp_sandbox_invoice_ticket[0]).toMatchObject({
      tenant_id: TENANT_ID,
      usuario_id: USER_ID,
      status: 'ready',
      action_log_id: tables.whatsapp_action_log[0].id,
      impact_hash: 'hash-1',
    });
    expect(result.ticket.status).toBe('ready');
    expect(tables.whatsapp_sandbox_message.map((row) => row.role)).toEqual(['user', 'assistant']);
    expect(tables.whatsapp_sandbox_message[1].content).toContain('Factura procesada');
  });

  it('creates a review ticket and blocks the real action when products are pending', async () => {
    mocks.procesarFacturaIa.mockResolvedValueOnce({
      ok: true,
      payload: {
        log_id: 'log-2',
        cabecera: {
          tipo_comprobante: 'factura_a',
          letra: 'A',
          punto_venta: 1,
          numero: 25,
          fecha_emision: '2026-05-16',
        },
        emisor: { razon_social: 'Proveedor Pendiente', cuit: '30711111119' },
        proveedor: { id: 'prov-1', nombre: 'Proveedor Pendiente' },
        crear_proveedor: null,
        items: [
          {
            indice: 0,
            codigo: 'ABC',
            descripcion: 'Producto sin match',
            cantidad: 2,
            unidad: 'unidad',
            precio_unitario: 50,
            subtotal: 100,
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
        totales: { total: 121 },
      },
    });
    mocks.prepararConfirmacion.mockResolvedValueOnce({
      impacto: {
        resumen: {
          proveedor_nombre: 'Proveedor Pendiente',
          total_items: 1,
          productos_vinculados: 0,
          productos_nuevos: 1,
          productos_para_revisar: 1,
          total: 121,
          afecta_stock: true,
          afecta_cuenta_corriente: true,
          actualizar_costos: true,
        },
        cambios_costos: [],
        advertencias: [],
        conflictos: ['1 producto(s) requieren revision de match.'],
        bloqueantes: [],
        requiere_confirmacion: true,
      },
      impactHash: 'hash-pending',
      confirmPayload: { log_id: 'log-2' },
    });

    const { db, tables } = createMockDb();
    const result = await processWhatsAppSandboxInvoiceUpload({
      db,
      tenantId: TENANT_ID,
      userId: USER_ID,
      role: 'admin',
      sucursalId: 'suc-1',
      archivos: [
        {
          name: 'factura-pendiente.pdf',
          type: 'application/pdf',
          size: 12,
          bytes: new Uint8Array([1, 2, 3]),
        },
      ],
    });

    if (!result.ok) throw new Error(result.error);
    expect(tables.whatsapp_action_log).toHaveLength(0);
    expect(tables.lector_factura_job[0]).toMatchObject({
      application_status: 'blocked',
      applied_error: '1 producto(s) pendientes de enlazar o revisar.',
    });
    expect(tables.whatsapp_sandbox_invoice_ticket).toHaveLength(1);
    expect(tables.whatsapp_sandbox_invoice_ticket[0]).toMatchObject({
      status: 'needs_review',
      action_log_id: null,
      impact_hash: 'hash-pending',
    });
    expect(tables.whatsapp_sandbox_invoice_ticket[0].pending_items).toEqual([
      expect.objectContaining({
        indice: 0,
        descripcion: 'Producto sin match',
        motivo: 'sin_producto',
      }),
    ]);
    expect(result.ticket.status).toBe('needs_review');
    expect(tables.whatsapp_sandbox_message[1].content).toContain('Ticket abierto');
  });
});
