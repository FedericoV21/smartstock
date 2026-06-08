import type { ArchivoFacturaEntrada } from '@/lib/lector-facturas/procesar-factura-ia';

export type LectorFacturaJobSource = 'api_publica' | 'whatsapp';

export type LectorFacturaJobArchivo = {
  nombre: string;
  mimeType: string;
  size: number;
  storageBucket: string;
  storagePath: string;
};

export type CrearLectorFacturaJobParams = {
  db: any;
  tenantId: string;
  sucursalId: string | null;
  userId: string;
  apiKeyId?: string | null;
  whatsappProcessingJobId?: string | null;
  source: LectorFacturaJobSource;
  archivos: LectorFacturaJobArchivo[];
  externalId?: string | null;
  idempotencyKey?: string | null;
  callbackUrl?: string | null;
};

const JOB_BUCKET = 'facturas-recibidas';

function safeName(name: string): string {
  const n = name.trim() || 'factura';
  return n.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function randomSuffix(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 10);
}

export async function subirArchivoLectorFacturaJob(params: {
  db: any;
  tenantId: string;
  source: LectorFacturaJobSource;
  archivo: ArchivoFacturaEntrada;
}): Promise<LectorFacturaJobArchivo> {
  const { db, tenantId, source, archivo } = params;
  const storagePath = `${tenantId}/lector-jobs/${source}/${Date.now()}_${randomSuffix()}_${safeName(archivo.name)}`;
  const body = Buffer.from(archivo.bytes);
  const { error } = await db.storage.from(JOB_BUCKET).upload(storagePath, body, {
    contentType: archivo.type,
    upsert: false,
  });
  if (error) throw new Error(`Storage upload job error: ${error.message}`);

  return {
    nombre: archivo.name,
    mimeType: archivo.type,
    size: archivo.size,
    storageBucket: JOB_BUCKET,
    storagePath,
  };
}

export async function leerArchivosLectorFacturaJob(params: {
  db: any;
  archivos: LectorFacturaJobArchivo[];
}): Promise<ArchivoFacturaEntrada[]> {
  const out: ArchivoFacturaEntrada[] = [];
  for (const archivo of params.archivos) {
    const { data, error } = await params.db.storage
      .from(archivo.storageBucket)
      .download(archivo.storagePath);
    if (error || !data) {
      throw new Error(error?.message ?? `No se pudo leer ${archivo.nombre}`);
    }
    const bytes = new Uint8Array(await data.arrayBuffer());
    out.push({
      name: archivo.nombre,
      type: archivo.mimeType,
      size: archivo.size || bytes.byteLength,
      bytes,
    });
  }
  return out;
}

export async function buscarJobIdempotente(params: {
  db: any;
  tenantId: string;
  apiKeyId: string;
  idempotencyKey: string | null | undefined;
}) {
  const idempotencyKey = params.idempotencyKey?.trim();
  if (!idempotencyKey) return null;
  const { data, error } = await params.db
    .from('lector_factura_job')
    .select('id, status, resultado, error_detail, created_at, finished_at')
    .eq('tenant_id', params.tenantId)
    .eq('api_key_id', params.apiKeyId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

export async function crearLectorFacturaJob(params: CrearLectorFacturaJobParams): Promise<{
  id: string;
  status: string;
}> {
  const { data, error } = await params.db
    .from('lector_factura_job')
    .insert({
      tenant_id: params.tenantId,
      sucursal_id: params.sucursalId,
      usuario_id: params.userId,
      api_key_id: params.apiKeyId ?? null,
      whatsapp_processing_job_id: params.whatsappProcessingJobId ?? null,
      source: params.source,
      status: 'queued',
      external_id: params.externalId?.trim() || null,
      idempotency_key: params.idempotencyKey?.trim() || null,
      callback_url: params.callbackUrl?.trim() || null,
      archivos: params.archivos,
    })
    .select('id, status')
    .single();

  if (error || !data?.id) {
    throw new Error(error?.message ?? 'No se pudo crear el job de lector de facturas');
  }

  return { id: String(data.id), status: String(data.status) };
}

export function parseJobArchivos(raw: unknown): LectorFacturaJobArchivo[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const r = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      const nombre = typeof r.nombre === 'string' ? r.nombre : '';
      const mimeType = typeof r.mimeType === 'string' ? r.mimeType : '';
      const storageBucket = typeof r.storageBucket === 'string' ? r.storageBucket : '';
      const storagePath = typeof r.storagePath === 'string' ? r.storagePath : '';
      const size = Number(r.size ?? 0);
      if (!nombre || !mimeType || !storageBucket || !storagePath) return null;
      return {
        nombre,
        mimeType,
        storageBucket,
        storagePath,
        size: Number.isFinite(size) && size > 0 ? size : 0,
      };
    })
    .filter((item): item is LectorFacturaJobArchivo => item != null);
}
