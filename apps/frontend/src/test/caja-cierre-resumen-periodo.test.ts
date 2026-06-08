import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET as cierreResumenGet } from '@/app/api/caja/cierre-z/[id]/resumen/route';
import { calcularSnapshot, minutosToIsoUtc } from '@/lib/caja/cierre-z-calculo';

const mocks = vi.hoisted(() => ({
  getTenantSession: vi.fn(),
  resolveAndValidateSucursalScope: vi.fn(),
}));

vi.mock('@/lib/api/tenant-session', () => ({
  getTenantSession: (...args: unknown[]) => mocks.getTenantSession(...args),
}));

vi.mock('@/lib/api/sucursal-scope', () => ({
  resolveAndValidateSucursalScope: (...args: unknown[]) => mocks.resolveAndValidateSucursalScope(...args),
}));

type QueryCall = { method: string; args: unknown[] };
type QueryResult = { data: unknown; error: { message: string } | null; count?: number | null };

class QueryMock {
  calls: QueryCall[] = [];

  constructor(private readonly result: QueryResult) {}

  select(...args: unknown[]): this {
    this.calls.push({ method: 'select', args });
    return this;
  }

  eq(...args: unknown[]): this {
    this.calls.push({ method: 'eq', args });
    return this;
  }

  gte(...args: unknown[]): this {
    this.calls.push({ method: 'gte', args });
    return this;
  }

  lte(...args: unknown[]): this {
    this.calls.push({ method: 'lte', args });
    return this;
  }

  is(...args: unknown[]): this {
    this.calls.push({ method: 'is', args });
    return this;
  }

  order(...args: unknown[]): this {
    this.calls.push({ method: 'order', args });
    return this;
  }

  limit(...args: unknown[]): this {
    this.calls.push({ method: 'limit', args });
    return this;
  }

  in(...args: unknown[]): this {
    this.calls.push({ method: 'in', args });
    return this;
  }

  maybeSingle(): Promise<QueryResult> {
    this.calls.push({ method: 'maybeSingle', args: [] });
    return Promise.resolve(this.result);
  }

  single(): Promise<QueryResult> {
    this.calls.push({ method: 'single', args: [] });
    return Promise.resolve(this.result);
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

function createSupabaseMock(results: Record<string, QueryResult>) {
  const builders = new Map<string, QueryMock[]>();
  const supabase = {
    from(table: string) {
      const builder = new QueryMock(results[table] ?? { data: [], error: null });
      const arr = builders.get(table) ?? [];
      arr.push(builder);
      builders.set(table, arr);
      return builder;
    },
  };
  return { supabase, builders };
}

describe('resumen de cierres de caja por periodo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveAndValidateSucursalScope.mockResolvedValue({ ok: true, sucursalId: 'suc-1' });
  });

  it('convierte horas de cierres parciales desde Argentina a UTC', () => {
    expect(minutosToIsoUtc('2026-05-18', 8 * 60)).toBe('2026-05-18T11:00:00.000Z');
    expect(minutosToIsoUtc('2026-05-18', 23 * 60 + 59)).toBe('2026-05-19T02:59:00.000Z');
  });

  it('calcula una sesion de apertura que cruza dias sin recortar a la fecha operativa inicial', async () => {
    const { supabase, builders } = createSupabaseMock({
      comprobante: {
        error: null,
        data: [
          {
            id: 'ticket-dia-1',
            total: 100,
            tipo: 'ticket',
            metodo_pago: 'efectivo',
            metodo_pago_detalle: null,
            caja_id: 'caja-1',
            created_at: '2026-05-18T23:30:00.000Z',
            numero_orden: 1,
          },
          {
            id: 'ticket-dia-2',
            total: 200,
            tipo: 'ticket',
            metodo_pago: 'efectivo',
            metodo_pago_detalle: null,
            caja_id: 'caja-1',
            created_at: '2026-05-19T12:00:00.000Z',
            numero_orden: 2,
          },
        ],
      },
      pago: { data: [], error: null },
    });

    const snapshot = await calcularSnapshot(supabase, {
      fechaOperativa: '2026-05-18',
      cajaIdNormalizada: 'caja-1',
      sucursalId: 'suc-1',
      rangoDesdeIso: '2026-05-18T23:00:00.000Z',
      rangoHastaIso: '2026-05-19T13:00:00.000Z',
      fondoApertura: 50,
      modoPeriodo: 'sesion_apertura',
      sesionAperturaId: 'ap-1',
    });

    expect(snapshot.total_comprobantes).toBe(2);
    expect(snapshot.ventas_netas).toBe(300);
    expect(snapshot.efectivo_esperado).toBe(350);
    expect(builders.get('comprobante')?.[0]?.calls).toEqual(
      expect.arrayContaining([
        { method: 'gte', args: ['fecha', '2026-05-18'] },
        { method: 'lte', args: ['fecha', '2026-05-19'] },
      ]),
    );
  });

  it('devuelve ordenes del cierre consolidando ticket y factura de la misma orden', async () => {
    const { supabase } = createSupabaseMock({
      cierre_z: {
        error: null,
        data: {
          id: 'cz-1',
          caja_id: 'caja-1',
          fecha_operativa: '2026-05-18',
          tipo_cierre: 'diario',
          rango_desde: '2026-05-18T23:00:00.000Z',
          rango_hasta: '2026-05-19T13:00:00.000Z',
          total_comprobantes: 2,
          ventas_brutas: 300,
          notas_credito_total: 0,
          ventas_netas: 300,
          pagos_cta_cte_total: 0,
          created_at: '2026-05-19T13:01:00.000Z',
          payload_resumen: {},
        },
      },
      cierre_z_medio_pago: {
        error: null,
        data: [{ metodo_pago: 'efectivo', monto_neto: 300, cantidad_comprobantes: 2 }],
      },
      comprobante: {
        error: null,
        data: [
          {
            id: 'ticket-7',
            tipo: 'ticket',
            numero: null,
            numero_caja: 7,
            numero_orden: 7,
            fecha: '2026-05-18',
            created_at: '2026-05-18T23:30:00.000Z',
            total: 100,
            metodo_pago: 'efectivo',
            metodo_pago_detalle: null,
            caja_id: 'caja-1',
            cliente: { nombre: 'Juan', razon_social: null },
            usuario: { nombre: 'Nico', apellido: 'Admin' },
          },
          {
            id: 'factura-7',
            tipo: 'factura_b',
            numero: 42,
            numero_caja: null,
            numero_orden: 7,
            fecha: '2026-05-18',
            created_at: '2026-05-18T23:31:00.000Z',
            total: 100,
            metodo_pago: 'efectivo',
            metodo_pago_detalle: null,
            caja_id: 'caja-1',
            cliente: { nombre: 'Juan', razon_social: null },
            usuario: { nombre: 'Nico', apellido: 'Admin' },
          },
          {
            id: 'ticket-8',
            tipo: 'ticket',
            numero: null,
            numero_caja: 8,
            numero_orden: 8,
            fecha: '2026-05-19',
            created_at: '2026-05-19T12:00:00.000Z',
            total: 200,
            metodo_pago: 'efectivo',
            metodo_pago_detalle: null,
            caja_id: 'caja-1',
            cliente: null,
            usuario: null,
          },
        ],
      },
    });
    mocks.getTenantSession.mockResolvedValue({
      tenantId: 'tenant-1',
      rol: 'admin',
      userId: 'user-1',
      supabase,
    });

    const res = await cierreResumenGet(
      new Request('http://localhost/api/caja/cierre-z/cz-1/resumen?sucursal_id=suc-1'),
      { params: Promise.resolve({ id: 'cz-1' }) },
    );
    const json = (await res.json()) as { ordenes: { id: string; numero_orden: number }[] };

    expect(res.status).toBe(200);
    expect(json.ordenes).toHaveLength(2);
    expect(json.ordenes.map((o) => o.id)).toEqual(['factura-7', 'ticket-8']);
  });
});
