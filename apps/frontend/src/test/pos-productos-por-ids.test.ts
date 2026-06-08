import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getTenantSession: vi.fn(),
  resolveAndValidateSucursalScope: vi.fn(),
  enriquecerProductosPosConSucursalCaja: vi.fn(),
  enrichProductosPayloadConTramos: vi.fn(),
  fetchStockVariantePorIds: vi.fn(),
}));

vi.mock('@/lib/api/tenant-session', () => ({
  getTenantSession: (...args: unknown[]) => mocks.getTenantSession(...args),
}));

vi.mock('@/lib/api/sucursal-scope', () => ({
  resolveAndValidateSucursalScope: (...args: unknown[]) =>
    mocks.resolveAndValidateSucursalScope(...args),
}));

vi.mock('@/lib/pos/enriquecer-productos-pos-sucursal-caja', () => ({
  enriquecerProductosPosConSucursalCaja: (...args: unknown[]) =>
    mocks.enriquecerProductosPosConSucursalCaja(...args),
}));

vi.mock('@/lib/productos/fetch-ganancia-tramos-batch', () => ({
  enrichProductosPayloadConTramos: (...args: unknown[]) =>
    mocks.enrichProductosPayloadConTramos(...args),
}));

vi.mock('@/lib/productos/variantes', () => ({
  etiquetaVariante: (_atributos: unknown, etiqueta?: string | null) => etiqueta ?? 'Variante',
  etiquetaProductoConVariante: (nombre: string, variante?: { etiqueta?: string | null } | null) =>
    variante?.etiqueta ? `${nombre} - ${variante.etiqueta}` : nombre,
  fetchStockVariantePorIds: (...args: unknown[]) => mocks.fetchStockVariantePorIds(...args),
}));

import { POST } from '@/app/api/pos/productos-por-ids/route';

const productoBase = {
  id: 'p-1',
  codigo: 'BASE-1',
  codigo_barras: '779111',
  nombre: 'Remera',
  precio_costo: 100,
  precio_venta: 150,
  porcentaje_ganancia: null,
  stock_actual: 3,
  stock_minimo: 0,
  unidad: 'unidad',
  unidad_compra: null,
  contenido_unidad_compra: null,
  es_pesable: false,
  usa_variantes: true,
  iva_porcentaje: 21,
  imagen_url: null,
  sucursal_id: 'suc-1',
  rubro: null,
  subrubro: null,
  categoria: null,
  proveedor: null,
};

function createSupabaseMock() {
  const productoIn = vi.fn().mockResolvedValue({ data: [productoBase], error: null });
  const varianteIn = vi.fn().mockResolvedValue({
    data: [
      {
        id: 'v-azul',
        producto_id: 'p-1',
        codigo: 'REM-AZUL',
        codigo_barras: '779222',
        atributos: { color: 'Azul' },
        etiqueta: 'Azul',
      },
    ],
    error: null,
  });

  const from = vi.fn((table: string) => {
    if (table === 'modulo_config') {
      const builder = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        maybeSingle: vi.fn().mockResolvedValue({ data: { facturador_pos: true }, error: null }),
      };
      return builder;
    }

    if (table === 'producto') {
      const builder = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        in: productoIn,
      };
      return builder;
    }

    if (table === 'producto_variante') {
      const builder = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        in: varianteIn,
      };
      return builder;
    }

    throw new Error(`Tabla inesperada: ${table}`);
  });

  return { from, productoIn, varianteIn };
}

function request(body: unknown) {
  return new Request('http://localhost/api/pos/productos-por-ids', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/pos/productos-por-ids', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveAndValidateSucursalScope.mockResolvedValue({ ok: true, sucursalId: 'suc-1' });
    mocks.enriquecerProductosPosConSucursalCaja.mockImplementation(async (_db, _tid, _sid, rows) => rows);
    mocks.enrichProductosPayloadConTramos.mockImplementation(async ({ productos }) =>
      productos.map((p: typeof productoBase) => ({ ...p, ganancia_tramos: [] })),
    );
    mocks.fetchStockVariantePorIds.mockResolvedValue(
      new Map([['v-azul', { stock_actual: 7, stock_minimo: 1, ubicacion: null }]]),
    );
  });

  it('mantiene compatibilidad con producto_ids', async () => {
    const supabase = createSupabaseMock();
    mocks.getTenantSession.mockResolvedValue({ tenantId: 'tenant-1', supabase });

    const res = await POST(request({ producto_ids: ['p-1'], sucursal_id: 'suc-1' }));
    const json = (await res.json()) as { productos: Array<{ id: string; producto_variante_id?: string }> };

    expect(res.status).toBe(200);
    expect(json.productos).toHaveLength(1);
    expect(json.productos[0].id).toBe('p-1');
    expect(supabase.productoIn).toHaveBeenCalledWith('id', ['p-1']);
    expect(supabase.varianteIn).not.toHaveBeenCalled();
  });

  it('rehidrata una seleccion con variante y stock de la sucursal', async () => {
    const supabase = createSupabaseMock();
    mocks.getTenantSession.mockResolvedValue({ tenantId: 'tenant-1', supabase });

    const res = await POST(
      request({
        selecciones: [{ producto_id: 'p-1', producto_variante_id: 'v-azul' }],
        sucursal_id: 'suc-1',
      }),
    );
    const json = (await res.json()) as {
      productos: Array<{
        id: string;
        codigo: string;
        codigo_barras: string;
        nombre: string;
        stock_actual: number;
        stock_minimo: number;
        producto_variante_id: string;
        variante: { id: string; etiqueta: string };
      }>;
    };

    expect(res.status).toBe(200);
    expect(json.productos[0]).toMatchObject({
      id: 'p-1',
      codigo: 'REM-AZUL',
      codigo_barras: '779222',
      nombre: 'Remera - Azul',
      stock_actual: 7,
      stock_minimo: 1,
      producto_variante_id: 'v-azul',
      variante: { id: 'v-azul', etiqueta: 'Azul' },
    });
    expect(supabase.productoIn).toHaveBeenCalledWith('id', ['p-1']);
    expect(supabase.varianteIn).toHaveBeenCalledWith('id', ['v-azul']);
  });
});
