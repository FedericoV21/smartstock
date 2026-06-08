import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hashExtractorApiKey } from '@/lib/api-extractor/keys';

const dbRef: { current: MockDb | null } = { current: null };
const mocks = vi.hoisted(() => ({
  extraerFacturaIaPura: vi.fn(),
}));

vi.mock('@/lib/supabase/env-keys', () => ({
  getSupabaseServiceRoleKey: () => 'service-role',
}));

vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: () => dbRef.current,
}));

vi.mock('@/lib/lector-facturas/extraer-factura-ia-pura', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/lector-facturas/extraer-factura-ia-pura')>();
  return {
    ...actual,
    extraerFacturaIaPura: (...args: any[]) => mocks.extraerFacturaIaPura(...args),
  };
});

function mockExtractorSuccess() {
  mocks.extraerFacturaIaPura.mockResolvedValue({
    ok: true,
    archivoNombre: 'factura.png',
    archivoMime: 'image/png',
    archivoTamano: 4,
    hojasResumen: [{ indice: 0 }],
    resultadosFinales: [],
    resultadosReintento: null,
    clean: {
      archivo_nombre: 'factura.png',
      cabecera: {
        tipo_comprobante: 'factura_a',
        letra: 'A',
        punto_venta: 1,
        numero: 25,
        fecha_emision: '2026-05-10',
        fecha_vencimiento: null,
        cae: null,
        cae_vencimiento: null,
      },
      emisor: { razon_social: 'Proveedor', cuit: '30111111118' },
      receptor: { razon_social: 'Cliente', cuit_dni: '20111111112' },
      items: [],
      totales: {
        subtotal: 0,
        iva_21: null,
        iva_10_5: null,
        iva_27: null,
        percepcion_iibb: null,
        percepcion_iva: null,
        impuesto_interno: null,
        otros_impuestos: null,
        total: 0,
      },
      condicion_pago: null,
      observaciones: null,
      validacion: { items_cuadran: true, total_cuadra: true, advertencias: [] },
      advertencias: [],
      multipagina: { total_archivos: 1, total_hojas: 1 },
    },
  });
}

import { POST } from './route';

type Row = Record<string, any>;

class MockQuery implements PromiseLike<{ data: any; error: any }> {
  private inserted: Row | Row[] | null = null;

  constructor(
    private db: MockDb,
    private table: string,
    private rows: Row[],
  ) {}

  select(): this {
    return this;
  }

  eq(column: string, value: unknown): this {
    this.rows = this.rows.filter((row) => row[column] === value);
    return this;
  }

  update(payload: Row): this {
    this.db.tables[this.table] = (this.db.tables[this.table] ?? []).map((row) =>
      this.rows.some((matched) => matched.id === row.id) ? { ...row, ...payload } : row,
    );
    return this;
  }

  insert(payload: Row | Row[]): this {
    this.inserted = payload;
    const rows = Array.isArray(payload) ? payload : [payload];
    this.db.tables[this.table] = [...(this.db.tables[this.table] ?? []), ...rows];
    return this;
  }

  maybeSingle() {
    return Promise.resolve({ data: this.rows[0] ?? null, error: null });
  }

  then<TResult1 = { data: any; error: any }, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: this.inserted ?? this.rows, error: null }).then(onfulfilled, onrejected);
  }
}

class MockDb {
  constructor(public tables: Record<string, Row[]>) {}

  from(table: string) {
    return new MockQuery(this, table, [...(this.tables[table] ?? [])]);
  }
}

function createDb(key: Row) {
  return new MockDb({
    api_extractor_key: [key],
    factura_extractor_log: [],
  });
}

function request(token: string, body: unknown) {
  return new Request('https://example.com/api/public/invoice-extractor/extract', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/public/invoice-extractor/extract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.extraerFacturaIaPura.mockReset();
    mockExtractorSuccess();
    dbRef.current = null;
    vi.unstubAllEnvs();
  });

  it('extrae una factura base64 con API key valida y guarda auditoria minima', async () => {
    const token = 'sex_route_ok';
    const db = createDb({
      id: 'key-1',
      nombre: 'Extractor',
      key_hash: hashExtractorApiKey(token),
      scopes: ['invoice:extract'],
      estado: 'activa',
      rate_limit_por_minuto: 10,
    });
    dbRef.current = db;

    const res = await POST(request(token, {
      archivo: {
        nombre: 'factura.png',
        mime_type: 'image/png',
        base64: Buffer.from([1, 2, 3, 4]).toString('base64'),
      },
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.archivo_nombre).toBe('factura.png');
    expect(json).not.toHaveProperty('match');
    expect(db.tables.factura_extractor_log).toHaveLength(1);
    expect(db.tables.factura_extractor_log[0]).toMatchObject({
      api_key_id: 'key-1',
      estado: 'extraido',
      archivo_nombre: 'factura.png',
    });
    expect(mocks.extraerFacturaIaPura).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'extractor_publico',
        visionConfig: expect.objectContaining({
          primary: 'gemini',
          geminiModel: 'gemini-2.5-flash',
        }),
      }),
    );
  });

  it('usa variables INVOICE_EXTRACTOR_* para aislar el proveedor del lector interno', async () => {
    vi.stubEnv('INVOICE_EXTRACTOR_IA_PRIMARY', 'gemini');
    vi.stubEnv('INVOICE_EXTRACTOR_GEMINI_API_KEY', 'g-extractor');
    vi.stubEnv('INVOICE_EXTRACTOR_GEMINI_MODEL', 'gemini-2.5-flash');
    vi.stubEnv('IA_VISION_PRIMARY', 'openrouter');
    vi.stubEnv('OPEN_ROUTER_API_KEY', 'or-global');

    const token = 'sex_route_env';
    dbRef.current = createDb({
      id: 'key-1',
      nombre: 'Extractor',
      key_hash: hashExtractorApiKey(token),
      scopes: ['invoice:extract'],
      estado: 'activa',
      rate_limit_por_minuto: 10,
    });

    await POST(request(token, {
      archivo: {
        nombre: 'factura.png',
        mime_type: 'image/png',
        base64: Buffer.from([1, 2, 3, 4]).toString('base64'),
      },
    }));

    expect(mocks.extraerFacturaIaPura).toHaveBeenCalledWith(
      expect.objectContaining({
        visionConfig: expect.objectContaining({
          primary: 'gemini',
          geminiApiKey: 'g-extractor',
          geminiModel: 'gemini-2.5-flash',
        }),
      }),
    );
  });

  it('rechaza API key invalida o revocada', async () => {
    const token = 'sex_route_auth';
    dbRef.current = createDb({
      id: 'key-1',
      nombre: 'Extractor',
      key_hash: hashExtractorApiKey('otra'),
      scopes: ['invoice:extract'],
      estado: 'activa',
      rate_limit_por_minuto: 10,
    });
    const invalid = await POST(request(token, { archivos: [] }));
    expect(invalid.status).toBe(401);

    dbRef.current = createDb({
      id: 'key-2',
      nombre: 'Extractor',
      key_hash: hashExtractorApiKey(token),
      scopes: ['invoice:extract'],
      estado: 'revocada',
      rate_limit_por_minuto: 10,
    });
    const revoked = await POST(request(token, { archivos: [] }));
    expect(revoked.status).toBe(403);
  });

  it('rechaza MIME invalido y registra log de error', async () => {
    const token = 'sex_route_mime';
    const db = createDb({
      id: 'key-1',
      nombre: 'Extractor',
      key_hash: hashExtractorApiKey(token),
      scopes: ['invoice:extract'],
      estado: 'activa',
      rate_limit_por_minuto: 10,
    });
    dbRef.current = db;

    const res = await POST(request(token, {
      archivo: {
        nombre: 'factura.txt',
        mime_type: 'text/plain',
        base64: Buffer.from('hola').toString('base64'),
      },
    }));

    expect(res.status).toBe(400);
    expect(db.tables.factura_extractor_log[0]).toMatchObject({
      estado: 'error',
      error_code: 'http_400',
    });
  });
});
