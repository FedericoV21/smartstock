import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/reportes/ventas-articulo/route';

const mocks = vi.hoisted(() => ({
  getTenantSession: vi.fn(),
  resolveAndValidateSucursalScope: vi.fn(),
}));

vi.mock('@/lib/api/tenant-session', () => ({
  getTenantSession: (...args: unknown[]) => mocks.getTenantSession(...args),
}));

vi.mock('@/lib/api/sucursal-scope', () => ({
  resolveAndValidateSucursalScope: (...args: unknown[]) =>
    mocks.resolveAndValidateSucursalScope(...args),
}));

type DbRow = Record<string, unknown>;
type TableData = Record<string, DbRow[]>;
type QueryResult = { data: unknown; error: { message: string } | null };

function getNestedValue(row: DbRow, column: string): unknown {
  return column.split('.').reduce<unknown>((acc, part) => {
    if (acc == null || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[part];
  }, row);
}

class MockQueryBuilder implements PromiseLike<QueryResult> {
  private rows: DbRow[];
  private isMaybeSingle = false;

  constructor(rows: DbRow[]) {
    this.rows = rows;
  }

  select(): this {
    return this;
  }

  eq(column: string, value: unknown): this {
    this.rows = this.rows.filter((row) => getNestedValue(row, column) === value);
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.rows = this.rows.filter((row) => values.includes(getNestedValue(row, column)));
    return this;
  }

  gte(column: string, value: string | number): this {
    this.rows = this.rows.filter((row) => String(getNestedValue(row, column) ?? '') >= String(value));
    return this;
  }

  lte(column: string, value: string | number): this {
    this.rows = this.rows.filter((row) => String(getNestedValue(row, column) ?? '') <= String(value));
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    const asc = options?.ascending ?? true;
    this.rows = [...this.rows].sort((a, b) =>
      asc
        ? String(getNestedValue(a, column) ?? '').localeCompare(String(getNestedValue(b, column) ?? ''))
        : String(getNestedValue(b, column) ?? '').localeCompare(String(getNestedValue(a, column) ?? '')),
    );
    return this;
  }

  limit(count: number): this {
    this.rows = this.rows.slice(0, count);
    return this;
  }

  range(from: number, to: number): this {
    this.rows = this.rows.slice(from, to + 1);
    return this;
  }

  maybeSingle() {
    this.isMaybeSingle = true;
    return this.execute();
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<QueryResult> {
    if (this.isMaybeSingle) return { data: this.rows[0] ?? null, error: null };
    return { data: this.rows, error: null };
  }
}

function createMockDb(data: TableData): { from(table: string): MockQueryBuilder } {
  return {
    from(table: string) {
      return new MockQueryBuilder((data[table] ?? []).map((row) => ({ ...row })));
    },
  };
}

const comprobante = {
  id: 'comp-1',
  fecha: '2026-05-08',
  tipo: 'ticket',
  estado: 'emitido',
  fiscalizado_por_id: null,
  sucursal_id: 'suc-1',
  total: 59_800,
};

const productoFotocopia = {
  id: 'prod-fotocopia',
  codigo: '231',
  nombre: 'fotocopia dni',
  stock_actual: -27,
  stock_minimo: 0,
  fecha_vencimiento: null,
  proveedor_id: 'prov-base',
  proveedor: { id: 'prov-base', nombre: 'BASE DATOS' },
  categoria: { id: 'cat-adriana', nombre: 'ADRIANA' },
};

const productoOtro = {
  id: 'prod-otro',
  codigo: '999',
  nombre: 'otro producto',
  stock_actual: 1,
  stock_minimo: 0,
  fecha_vencimiento: null,
  proveedor_id: 'prov-otro',
  proveedor: { id: 'prov-otro', nombre: 'OTRO' },
  categoria: { id: 'cat-otra', nombre: 'OTRA' },
};

function buildSupabase(comprobanteItems?: DbRow[]) {
  return createMockDb({
    modulo_config: [{ facturador_simple: true }],
    movimiento: [],
    comprobante_item: comprobanteItems ?? [
      {
        id: 'item-fotocopia',
        created_at: '2026-05-08T10:00:00.000Z',
        cantidad: 3,
        precio_costo: 200,
        subtotal: 600,
        producto_id: productoFotocopia.id,
        comprobante,
        producto: productoFotocopia,
      },
      {
        id: 'item-otro',
        created_at: '2026-05-08T10:01:00.000Z',
        cantidad: 1,
        precio_costo: 40_000,
        subtotal: 59_200,
        producto_id: productoOtro.id,
        comprobante,
        producto: productoOtro,
      },
    ],
  });
}

function request(query: string, desde = '2026-05-08', hasta = '2026-05-10') {
  return new Request(
    `http://localhost/api/reportes/ventas-articulo?periodo=rango&desde=${desde}&hasta=${hasta}&${query}`,
  );
}

describe('GET /api/reportes/ventas-articulo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getTenantSession.mockResolvedValue({
      tenantId: 'tenant-1',
      supabase: buildSupabase(),
    });
    mocks.resolveAndValidateSucursalScope.mockResolvedValue({ ok: true, sucursalId: null });
  });

  it('no prorratea el total del comprobante solo sobre la categoria filtrada', async () => {
    const res = await GET(request('categoria_id=cat-adriana'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.filas).toHaveLength(1);
    expect(json.filas[0]).toMatchObject({
      producto_id: 'prod-fotocopia',
      unidades: 3,
      importe_venta: 600,
      margen: 0,
    });
  });

  it('usa todas las lineas del comprobante para el factor aunque se filtre por producto', async () => {
    const res = await GET(request('producto_id=prod-fotocopia'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.filas).toHaveLength(1);
    expect(json.filas[0].importe_venta).toBe(600);
  });

  it('pagina todas las lineas del rango antes de calcular totales', async () => {
    const productoMasivo = {
      ...productoFotocopia,
      id: 'prod-masivo',
      codigo: 'MAS',
      nombre: 'producto masivo',
      categoria: { id: 'cat-masiva', nombre: 'MASIVA' },
    };
    const productoFinal = {
      ...productoOtro,
      id: 'prod-final',
      codigo: 'FIN',
      nombre: 'producto final',
      categoria: { id: 'cat-final', nombre: 'FINAL' },
    };
    const rows: DbRow[] = Array.from({ length: 1000 }, (_, i) => {
      const comp = {
        ...comprobante,
        id: `comp-12-18-${i}`,
        fecha: '2026-05-18',
        total: 10,
      };
      return {
        id: `item-12-18-${i}`,
        created_at: `2026-05-18T10:${String(i % 60).padStart(2, '0')}:00.000Z`,
        cantidad: 1,
        precio_costo: 0,
        subtotal: 10,
        producto_id: productoMasivo.id,
        comprobante: comp,
        producto: productoMasivo,
      };
    });
    rows.push({
      id: 'item-19-21',
      created_at: '2026-05-19T10:00:00.000Z',
      cantidad: 1,
      precio_costo: 0,
      subtotal: 500,
      producto_id: productoFinal.id,
      comprobante: {
        ...comprobante,
        id: 'comp-19-21',
        fecha: '2026-05-19',
        total: 500,
      },
      producto: productoFinal,
    });

    mocks.getTenantSession.mockResolvedValue({
      tenantId: 'tenant-1',
      supabase: buildSupabase(rows),
    });

    const resHasta18 = await GET(request('', '2026-05-12', '2026-05-18'));
    const res19a21 = await GET(request('', '2026-05-19', '2026-05-21'));
    const resCompleto = await GET(request('', '2026-05-12', '2026-05-21'));
    const hasta18 = await resHasta18.json();
    const desde19 = await res19a21.json();
    const completo = await resCompleto.json();

    expect(completo.indicadores.total_importe_venta).toBe(
      hasta18.indicadores.total_importe_venta + desde19.indicadores.total_importe_venta,
    );
    expect(completo.indicadores.total_importe_venta).toBe(10_500);
    expect(completo.filas).toHaveLength(2);
  });
});
