import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ia/limite', () => ({
  verificarLimiteIA: vi.fn(async () => ({ permitido: true, usadas: 1, limite: 10 })),
}));

vi.mock('@/lib/ia/vision-extraccion', () => ({
  llamarVisionExtraccionJson: vi.fn(async () => ({
    text: JSON.stringify({
      tipo_comprobante: 'factura_a',
      letra: 'A',
      punto_venta: 1,
      numero: 25,
      fecha_emision: '2026-05-10',
      fecha_vencimiento: null,
      emisor: {
        razon_social: 'Proveedor Uno',
        cuit: '30999999991',
        domicilio: null,
        condicion_iva: 'responsable_inscripto',
        ingresos_brutos: null,
        inicio_actividades: null,
      },
      receptor: {
        razon_social: 'SmartStock Demo',
        cuit_dni: '20111111112',
        domicilio: null,
        condicion_iva: 'responsable_inscripto',
      },
      items: [
        {
          codigo: 'ABC-1',
          descripcion: 'Producto factura',
          cantidad: 2,
          unidad: 'unidad',
          precio_unitario: 100,
          bonificacion: null,
          subtotal: 200,
        },
      ],
      subtotal: 200,
      iva_21: 42,
      iva_10_5: null,
      iva_27: null,
      percepcion_iibb: null,
      percepcion_iva: null,
      impuesto_interno: null,
      otros_impuestos: null,
      total: 242,
      condicion_pago: 'Cuenta corriente',
      cae: null,
      cae_vencimiento: null,
      observaciones: null,
    }),
    meta: { provider: 'gemini', model: 'test', attempts: [] },
  })),
}));

import {
  procesarFacturaIa,
  validarArchivosFacturaIa,
  type ArchivoFacturaEntrada,
} from './procesar-factura-ia';
import { extraerFacturaIaPura } from './extraer-factura-ia-pura';
import { llamarVisionExtraccionJson } from '@/lib/ia/vision-extraccion';

type Row = Record<string, any>;

class MockQuery implements PromiseLike<{ data: any; error: any }> {
  private rows: Row[];
  private inserted: Row | Row[] | null = null;

  constructor(
    private db: MockDb,
    private table: string,
    rows: Row[],
  ) {
    this.rows = rows;
  }

  select(): this {
    return this;
  }

  insert(payload: Row | Row[]): this {
    this.inserted = Array.isArray(payload)
      ? payload.map((p) => this.withIdIfNeeded(p))
      : this.withIdIfNeeded(payload);
    const rows = Array.isArray(this.inserted) ? this.inserted : [this.inserted];
    this.db.tables[this.table] = [...(this.db.tables[this.table] ?? []), ...rows];
    return this;
  }

  update(payload: Row): this {
    this.rows = this.rows.map((row) => ({ ...row, ...payload }));
    return this;
  }

  eq(column: string, value: unknown): this {
    this.rows = this.rows.filter((row) => row[column] === value);
    return this;
  }

  maybeSingle() {
    return Promise.resolve({ data: this.rows[0] ?? null, error: null });
  }

  single() {
    const data = Array.isArray(this.inserted)
      ? this.inserted[0]
      : this.inserted ?? this.rows[0] ?? null;
    return Promise.resolve({
      data,
      error: data ? null : { message: 'No row' },
    });
  }

  then<TResult1 = { data: any; error: any }, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: this.inserted ?? this.rows, error: null }).then(
      onfulfilled,
      onrejected,
    );
  }

  private withIdIfNeeded(row: Row): Row {
    if (this.table === 'lector_factura_log') return { id: 'log-1', ...row };
    return row;
  }
}

class MockDb {
  uploads: Array<{ bucket: string; path: string; contentType: string }> = [];

  constructor(public tables: Record<string, Row[]>) {}

  from(table: string) {
    return new MockQuery(this, table, [...(this.tables[table] ?? [])]);
  }

  storage = {
    from: (bucket: string) => ({
      upload: async (path: string, _body: Buffer, opts: { contentType: string }) => {
        this.uploads.push({ bucket, path, contentType: opts.contentType });
        return { error: null };
      },
    }),
  };
}

function createDb() {
  return new MockDb({
    tenant: [{ id: 'tenant-1', cuit: '20111111112', iva_porcentaje_default: 21 }],
    proveedor: [{ id: 'prov-1', tenant_id: 'tenant-1', cuit: '30999999991', nombre: 'Proveedor Uno' }],
    cliente: [],
    producto: [
      {
        id: 'prod-1',
        tenant_id: 'tenant-1',
        activo: true,
        codigo: 'ABC-1',
        nombre: 'Producto catalogo',
        iva_porcentaje: 21,
        unidad: 'unidad',
        unidad_compra: null,
        contenido_unidad_compra: null,
      },
    ],
    importacion_log: [],
    lector_factura_log: [],
  });
}

describe('validarArchivosFacturaIa', () => {
  it('rechaza MIME no soportado', () => {
    const r = validarArchivosFacturaIa([
      { name: 'factura.txt', type: 'text/plain', size: 10, bytes: new Uint8Array([1]) },
    ]);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it('acepta imagen soportada', () => {
    const r = validarArchivosFacturaIa([
      { name: 'factura.png', type: 'image/png', size: 10, bytes: new Uint8Array([1]) },
    ]);

    expect(r.ok).toBe(true);
  });
});

describe('procesarFacturaIa', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('procesa factura con IA mockeada y devuelve preview matcheado por codigo', async () => {
    const db = createDb();
    const archivo: ArchivoFacturaEntrada = {
      name: 'factura.png',
      type: 'image/png',
      size: 4,
      bytes: new Uint8Array([1, 2, 3, 4]),
    };

    const result = await procesarFacturaIa({
      supabase: db as any,
      tenantId: 'tenant-1',
      userId: 'user-1',
      archivos: [archivo],
      source: 'api_publica',
      aplicarRateLimit: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.payload.log_id).toBe('log-1');
    expect(result.payload.direccion).toBe('recibida');
    expect(result.payload.proveedor?.id).toBe('prov-1');
    expect(result.payload.items[0]?.match).toMatchObject({
      producto_id: 'prod-1',
      metodo: 'codigo_exacto',
      requires_review: false,
    });
    expect(db.uploads).toHaveLength(1);
    expect(db.tables.importacion_log).toHaveLength(1);
    expect(db.tables.lector_factura_log[0]?.datos_extraidos?.items[0]?.match?.requires_review).toBe(false);
  });
});

describe('extraerFacturaIaPura', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('devuelve JSON limpio sin campos internos de SmartStock', async () => {
    const archivo: ArchivoFacturaEntrada = {
      name: 'factura.png',
      type: 'image/png',
      size: 4,
      bytes: new Uint8Array([1, 2, 3, 4]),
    };

    const result = await extraerFacturaIaPura({
      archivos: [archivo],
      source: 'extractor_publico',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.clean.archivo_nombre).toBe('factura.png');
    expect(result.clean.cabecera.numero).toBe(25);
    expect(result.clean.items[0]?.codigo).toBe('ABC-1');
    expect(result.clean).not.toHaveProperty('proveedor');
    expect(result.clean).not.toHaveProperty('match');
  });

  it('devuelve error de status cuando la IA no responde JSON valido', async () => {
    vi.mocked(llamarVisionExtraccionJson).mockRejectedValueOnce(new Error('modelo caido'));
    const result = await extraerFacturaIaPura({
      archivos: [
        { name: 'factura.png', type: 'image/png', size: 4, bytes: new Uint8Array([1, 2, 3, 4]) },
      ],
      source: 'extractor_publico',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.status).toBe(502);
    expect(result.error).toContain('Error al procesar');
  });
});
