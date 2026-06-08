import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DELETE as DELETE_BORRADOR,
} from '@/app/api/importar/borradores/[id]/route';
import {
  POST as PREPARAR_CONFIRMACION,
} from '@/app/api/importar/borradores/[id]/preparar-confirmacion/route';
import {
  GET as LIST_BORRADORES,
  POST as CREATE_BORRADOR,
} from '@/app/api/importar/borradores/route';
import {
  IMPORTACION_BORRADOR_CHUNK_SIZE,
  leerFilasBorrador,
  metadataDesdePayload,
  normalizarFilasBorrador,
  reemplazarChunksBorrador,
  validarPayloadBorrador,
} from '@/lib/importar/borradores-server';
import type { ImportacionBorradorPayloadV1 } from '@/lib/importar/borradores';

const mocks = vi.hoisted(() => ({
  moduloGuardAny: vi.fn(),
  getTenantSession: vi.fn(),
  rejectIfVisor: vi.fn(),
  resolveAndValidateSucursalScope: vi.fn(),
}));

vi.mock('@/lib/modulos/guard', () => ({
  moduloGuardAny: (...args: unknown[]) => mocks.moduloGuardAny(...args),
}));

vi.mock('@/lib/api/tenant-session', () => ({
  getTenantSession: (...args: unknown[]) => mocks.getTenantSession(...args),
  rejectIfVisor: (...args: unknown[]) => mocks.rejectIfVisor(...args),
}));

vi.mock('@/lib/api/sucursal-scope', () => ({
  resolveAndValidateSucursalScope: (...args: unknown[]) =>
    mocks.resolveAndValidateSucursalScope(...args),
}));

const DRAFT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_USER_ID = '33333333-3333-4333-8333-333333333333';
const PROVEEDOR_ID = '44444444-4444-4444-8444-444444444444';

function payloadBase(
  overrides: Partial<ImportacionBorradorPayloadV1> = {},
): ImportacionBorradorPayloadV1 {
  return {
    version: 1,
    flujo: 'importar',
    paso: 'preview',
    origenImportacion: 'importacion_excel',
    archivo: {
      nombreArchivo: 'lista.xlsx',
      headers: ['Codigo', 'Nombre', 'Costo'],
      totalFilas: 2,
    },
    proveedorId: PROVEEDOR_ID,
    guardarPerfil: true,
    mapeo: [
      {
        headerOriginal: 'Codigo',
        campoDetectado: 'codigo',
        confianza: 'exacta',
        ignorar: false,
      },
      {
        headerOriginal: 'Nombre',
        campoDetectado: 'nombre',
        confianza: 'exacta',
        ignorar: false,
      },
    ],
    preview: {
      forzarProductosPesables: true,
      aplicarInferenciaPesablePorNombre: true,
      productosEnlazados: {
        '2': { producto_id: 'prod-2', nombre: 'Producto enlazado' },
      },
    },
    ...overrides,
  };
}

function session(rol = 'admin', supabase: unknown = {}) {
  return {
    tenantId: 'tenant-1',
    userId: USER_ID,
    rol,
    isSuperAdmin: false,
    supabase,
  };
}

function request(url: string, body?: unknown, method = 'POST') {
  return new Request(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function ctx(id = DRAFT_ID) {
  return { params: Promise.resolve({ id }) };
}

function listSupabase(rows: unknown[]) {
  const eqCalls: Array<[string, unknown]> = [];
  const builder: any = {
    select: vi.fn(() => builder),
    eq: vi.fn((col: string, val: unknown) => {
      eqCalls.push([col, val]);
      return builder;
    }),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve, reject),
  };
  return { from: vi.fn(() => builder), eqCalls };
}

function deleteSupabase(row: unknown) {
  const deleteEqCalls: Array<[string, unknown]> = [];
  const selectBuilder = {
    eq: vi.fn(() => selectBuilder),
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
  };
  const deleteBuilder: any = {
    eq: vi.fn((col: string, val: unknown) => {
      deleteEqCalls.push([col, val]);
      return deleteBuilder;
    }),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve({ error: null }).then(resolve, reject),
  };
  const table = {
    select: vi.fn(() => selectBuilder),
    delete: vi.fn(() => deleteBuilder),
  };
  return { from: vi.fn(() => table), deleteEqCalls };
}

function prepararSupabase(bytes: Buffer) {
  const upsertImportacionArchivo = vi.fn().mockResolvedValue({ error: null });
  const borradorUpdate = vi.fn(() => ({
    eq: vi.fn(() => ({
      eq: vi.fn().mockResolvedValue({ error: null }),
    })),
  }));
  const borradorBuilder = {
    eq: vi.fn(() => borradorBuilder),
    maybeSingle: vi.fn().mockResolvedValue({
      data: {
        id: DRAFT_ID,
        tenant_id: 'tenant-1',
        usuario_id: OTHER_USER_ID,
        sucursal_id: 'suc-1',
        archivo_nombre: 'lista.pdf',
        payload: payloadBase({ origenImportacion: 'ia_pdf', flujo: 'pdf_excel' }),
      },
      error: null,
    }),
  };
  const archivoBuilder = {
    eq: vi.fn(() => archivoBuilder),
    maybeSingle: vi.fn().mockResolvedValue({
      data: {
        archivo_nombre: 'lista.pdf',
        archivo_mime: 'application/pdf',
        archivo_tamano: bytes.length,
        archivo_bytes: bytes,
      },
      error: null,
    }),
  };
  const chunkCountBuilder = {
    eq: vi.fn(() => chunkCountBuilder),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve({ count: 2, error: null }).then(resolve, reject),
  };
  const from = vi.fn((table: string) => {
    if (table === 'importacion_borrador') {
      return {
        select: vi.fn(() => borradorBuilder),
        update: borradorUpdate,
      };
    }
    if (table === 'importacion_borrador_archivo') {
      return { select: vi.fn(() => archivoBuilder) };
    }
    if (table === 'importacion_borrador_chunk') {
      return { select: vi.fn(() => chunkCountBuilder) };
    }
    if (table === 'importacion_archivo') {
      return { upsert: upsertImportacionArchivo };
    }
    throw new Error(`Tabla inesperada: ${table}`);
  });
  return { from, upsertImportacionArchivo, borradorUpdate };
}

describe('borradores persistentes de importacion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.moduloGuardAny.mockResolvedValue({ allowed: true });
    mocks.rejectIfVisor.mockReturnValue(null);
    mocks.resolveAndValidateSucursalScope.mockResolvedValue({ ok: true, sucursalId: 'suc-1' });
  });

  it('serializa payloads de importar y PDF a Excel conservando paso, proveedor, filas y preview', async () => {
    const payloadImportar = validarPayloadBorrador(payloadBase());
    expect(metadataDesdePayload(payloadImportar)).toMatchObject({
      proveedor_id: PROVEEDOR_ID,
      flujo: 'importar',
      paso: 'preview',
      origen: 'importacion_excel',
      archivo_nombre: 'lista.xlsx',
      total_filas: 2,
    });

    const payloadPdf = validarPayloadBorrador(
      payloadBase({
        flujo: 'pdf_excel',
        origenImportacion: 'ia_pdf',
        paso: 'mapeo',
        archivo: { nombreArchivo: 'lista.pdf', headers: ['A'], totalFilas: 1 },
        proveedorId: null,
        guardarPerfil: false,
      }),
    );
    expect(metadataDesdePayload(payloadPdf)).toMatchObject({
      proveedor_id: null,
      flujo: 'pdf_excel',
      paso: 'mapeo',
      origen: 'ia_pdf',
      archivo_nombre: 'lista.pdf',
      total_filas: 1,
    });

    const filas = Array.from({ length: IMPORTACION_BORRADOR_CHUNK_SIZE + 1 }, (_, i) => ({
      Codigo: `SKU-${i}`,
      Nombre: `Producto ${i}`,
    }));
    const insertedChunks: Array<{ chunk_index: number; row_count: number; filas: unknown[] }> = [];
    const chunkQuery: any = {
      eq: vi.fn(() => chunkQuery),
      order: vi.fn(() => chunkQuery),
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve({ data: insertedChunks, error: null }).then(resolve, reject),
    };
    const deleteQuery = {
      eq: vi.fn().mockResolvedValue({ error: null }),
    };
    const db = {
      from: vi.fn(() => ({
        delete: vi.fn(() => deleteQuery),
        insert: vi.fn((rows: typeof insertedChunks) => {
          insertedChunks.push(...rows);
          return Promise.resolve({ error: null });
        }),
        select: vi.fn(() => chunkQuery),
      })),
    };

    await reemplazarChunksBorrador(db, DRAFT_ID, normalizarFilasBorrador(filas));
    expect(insertedChunks).toHaveLength(2);
    expect(insertedChunks.map((c) => c.row_count)).toEqual([500, 1]);
    await expect(leerFilasBorrador(db, DRAFT_ID)).resolves.toEqual(filas);
  });

  it('lista todos los borradores para admin y solo los propios para no-admin', async () => {
    const row = {
      id: DRAFT_ID,
      flujo: 'importar',
      paso: 'preview',
      origen: 'importacion_excel',
      archivo_nombre: 'lista.xlsx',
      total_filas: 2,
      usuario_id: OTHER_USER_ID,
      created_at: '2026-05-15T12:00:00Z',
      updated_at: '2026-05-15T12:30:00Z',
      importacion_borrador_archivo: [{ borrador_id: DRAFT_ID }],
    };

    const adminDb = listSupabase([row]);
    mocks.getTenantSession.mockResolvedValueOnce(session('admin', adminDb));
    const adminRes = await LIST_BORRADORES(
      new Request('http://localhost/api/importar/borradores?flujo=importar') as any,
    );
    expect(adminRes.status).toBe(200);
    expect(adminDb.eqCalls).not.toContainEqual(['usuario_id', USER_ID]);
    await expect(adminRes.json()).resolves.toMatchObject({
      borradores: [{ id: DRAFT_ID, tiene_archivo: true }],
    });

    const operadorDb = listSupabase([row]);
    mocks.getTenantSession.mockResolvedValueOnce(session('operador', operadorDb));
    const operadorRes = await LIST_BORRADORES(
      new Request('http://localhost/api/importar/borradores') as any,
    );
    expect(operadorRes.status).toBe(200);
    expect(operadorDb.eqCalls).toContainEqual(['usuario_id', USER_ID]);
  });

  it('bloquea creacion para visor antes de insertar', async () => {
    const db = { from: vi.fn() };
    mocks.getTenantSession.mockResolvedValue(session('visor', db));
    mocks.rejectIfVisor.mockReturnValue(Response.json({ error: 'Sin permisos' }, { status: 403 }));

    const res = await CREATE_BORRADOR(
      request('http://localhost/api/importar/borradores', { payload: payloadBase() }),
    );

    expect(res.status).toBe(403);
    expect(db.from).not.toHaveBeenCalled();
  });

  it('elimina el borrador por la tabla principal para que la base cascade chunks y archivo', async () => {
    const db = deleteSupabase({ id: DRAFT_ID, usuario_id: USER_ID });
    mocks.getTenantSession.mockResolvedValue(session('operador', db));

    const res = (await DELETE_BORRADOR(
      request('http://localhost/api/importar/borradores', undefined, 'DELETE'),
      ctx(),
    ))!;

    expect(res.status).toBe(200);
    expect(db.from).toHaveBeenCalledWith('importacion_borrador');
    expect(db.deleteEqCalls).toEqual([
      ['id', DRAFT_ID],
      ['tenant_id', 'tenant-1'],
    ]);
  });

  it('preparar-confirmacion copia los bytes del borrador a importacion_archivo', async () => {
    const bytes = Buffer.from('%PDF-test');
    const db = prepararSupabase(bytes);
    mocks.getTenantSession.mockResolvedValue(session('admin', db));

    const res = (await PREPARAR_CONFIRMACION(
      request('http://localhost/api/importar/borradores/preparar', undefined, 'POST'),
      ctx(),
    ))!;
    const json = (await res.json()) as {
      carga_id: string;
      sucursal_id: string;
      archivo_mime: string;
      archivo_tamano: number;
      chunk_count: number;
    };

    expect(res.status).toBe(200);
    expect(json.sucursal_id).toBe('suc-1');
    expect(json.archivo_mime).toBe('application/pdf');
    expect(json.archivo_tamano).toBe(bytes.length);
    expect(json.chunk_count).toBe(2);
    expect(db.upsertImportacionArchivo).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 'tenant-1',
        carga_id: json.carga_id,
        archivo_nombre: 'lista.pdf',
        archivo_mime: 'application/pdf',
        archivo_bytes: bytes,
      }),
      { onConflict: 'tenant_id,carga_id' },
    );
  });
});
