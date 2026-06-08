import { getPublicAppBaseUrl } from '@/lib/supabase/env-keys';
import {
  datosExtraidosConPayloadBorrador,
  metadataUpdateDesdePayload,
  payloadBorradorDesdeLog,
  payloadGuardadoDesdeDatos,
  uuidOk,
} from '@/lib/lector-facturas/borradores-server';

type JsonRecord = Record<string, unknown>;

export type BorradorWhatsappSnapshot = {
  status: 'needs_review' | 'ready' | 'closed' | 'applied' | 'error';
};

export type BorradorWhatsappMeta = {
  lectorFacturaJobId?: string | null;
  whatsappTicketId?: string | null;
};

function isRecord(v: unknown): v is JsonRecord {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

export function requiereBorradorWebWhatsapp(snapshot: BorradorWhatsappSnapshot): boolean {
  return snapshot.status === 'needs_review';
}

export function urlBorradorLectorFactura(logId: string): string {
  const base = getPublicAppBaseUrl();
  return `${base}/lector-facturas?borrador=${encodeURIComponent(logId)}`;
}

export function logIdDesdeResultadoFactura(resultado: unknown): string | null {
  if (!isRecord(resultado)) return null;
  const logId = resultado.log_id;
  return typeof logId === 'string' && uuidOk(logId) ? logId : null;
}

/** Fusiona items y campos clave del job WA en datos_extraidos del log. */
export function fusionarResultadoJobEnDatosExtraidos(
  datosExtraidos: unknown,
  resultadoJob: unknown,
): JsonRecord {
  const base = isRecord(datosExtraidos) ? { ...datosExtraidos } : {};
  const job = isRecord(resultadoJob) ? resultadoJob : null;
  if (!job) return base;

  if (Array.isArray(job.items)) {
    base.items = job.items;
  }
  if (job.direccion === 'recibida' || job.direccion === 'emitida' || job.direccion === 'desconocida') {
    base.direccion = job.direccion;
  }
  if (isRecord(job.cabecera)) base.cabecera = job.cabecera;
  if (isRecord(job.emisor)) base.emisor = job.emisor;
  if (isRecord(job.receptor)) base.receptor = job.receptor;
  if (isRecord(job.totales)) base.totales = job.totales;
  if (isRecord(job.validacion)) base.validacion = job.validacion;
  if (typeof job.condicion_pago === 'string' || job.condicion_pago === null) {
    base.condicion_pago = job.condicion_pago;
  }
  if (typeof job.observaciones === 'string' || job.observaciones === null) {
    base.observaciones = job.observaciones;
  }
  if (isRecord(job.multipagina)) base.multipagina = job.multipagina;

  return base;
}

export function datosExtraidosConMetaWhatsapp(
  datosExtraidos: JsonRecord,
  meta: BorradorWhatsappMeta,
): JsonRecord {
  return {
    ...datosExtraidos,
    origen_canal: 'whatsapp',
    ...(meta.lectorFacturaJobId ? { lector_factura_job_id: meta.lectorFacturaJobId } : {}),
    ...(meta.whatsappTicketId ? { whatsapp_ticket_id: meta.whatsappTicketId } : {}),
  };
}

export function logTieneBorradorWhatsapp(datosExtraidos: unknown): boolean {
  if (!isRecord(datosExtraidos)) return false;
  if (datosExtraidos.origen_canal === 'whatsapp') return true;
  return payloadGuardadoDesdeDatos(datosExtraidos) != null;
}

export async function ivaDefaultTenant(db: any, tenantId: string): Promise<number> {
  const { data } = await db
    .from('tenant')
    .select('iva_porcentaje_default')
    .eq('id', tenantId)
    .maybeSingle();
  const iva = data?.iva_porcentaje_default;
  return typeof iva === 'number' && Number.isFinite(iva) ? iva : 21;
}

export async function persistirBorradorLectorFacturaWhatsapp(params: {
  db: any;
  tenantId: string;
  logId: string;
  resultadoJob?: unknown;
  meta?: BorradorWhatsappMeta;
}): Promise<{ logId: string; url: string }> {
  if (!uuidOk(params.logId)) {
    throw new Error('ID de log de factura invalido');
  }

  const ivaDefault = await ivaDefaultTenant(params.db, params.tenantId);

  const { data: row, error: loadErr } = await params.db
    .from('lector_factura_log')
    .select(
      'id, tenant_id, usuario_id, archivo_nombre, archivo_mime, archivo_tamano, datos_extraidos, direccion, proveedor_id, cliente_id, estado',
    )
    .eq('id', params.logId)
    .eq('tenant_id', params.tenantId)
    .eq('estado', 'extraido')
    .maybeSingle();

  if (loadErr) throw new Error(loadErr.message);
  if (!row?.id) throw new Error('Log de factura no encontrado o ya confirmado');

  const mergedDatos = fusionarResultadoJobEnDatosExtraidos(row.datos_extraidos, params.resultadoJob);
  const datosConMeta = datosExtraidosConMetaWhatsapp(mergedDatos, params.meta ?? {});

  const rowForPayload = {
    ...row,
    datos_extraidos: datosConMeta,
    ...(params.resultadoJob && isRecord(params.resultadoJob)
      ? {
          proveedor_id:
            isRecord(params.resultadoJob.proveedor) && typeof params.resultadoJob.proveedor.id === 'string'
              ? params.resultadoJob.proveedor.id
              : row.proveedor_id,
          cliente_id:
            isRecord(params.resultadoJob.cliente) && typeof params.resultadoJob.cliente.id === 'string'
              ? params.resultadoJob.cliente.id
              : row.cliente_id,
          direccion:
            params.resultadoJob.direccion === 'recibida' ||
            params.resultadoJob.direccion === 'emitida' ||
            params.resultadoJob.direccion === 'desconocida'
              ? params.resultadoJob.direccion
              : row.direccion,
        }
      : {}),
  };

  const payload = payloadBorradorDesdeLog(rowForPayload, ivaDefault);
  const datosFinales = datosExtraidosConPayloadBorrador(datosConMeta, payload);
  const metadata = metadataUpdateDesdePayload(payload);

  const { error: updateErr } = await params.db
    .from('lector_factura_log')
    .update({
      datos_extraidos: datosFinales,
      ...metadata,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.logId)
    .eq('tenant_id', params.tenantId)
    .eq('estado', 'extraido');

  if (updateErr) throw new Error(updateErr.message);

  return {
    logId: params.logId,
    url: urlBorradorLectorFactura(params.logId),
  };
}

/** Persiste borrador si el ticket requiere revision; devuelve URL o null si falla. */
function metaDesdeDatosExtraidos(datosExtraidos: unknown): BorradorWhatsappMeta {
  if (!isRecord(datosExtraidos)) return {};
  return {
    lectorFacturaJobId:
      typeof datosExtraidos.lector_factura_job_id === 'string'
        ? datosExtraidos.lector_factura_job_id
        : null,
    whatsappTicketId:
      typeof datosExtraidos.whatsapp_ticket_id === 'string'
        ? datosExtraidos.whatsapp_ticket_id
        : null,
  };
}

/** Re-guarda borrador tras enlazar item por chat (job mutado, log desactualizado). */
export async function sincronizarBorradorWhatsappDesdeJob(params: {
  db: any;
  tenantId: string;
  resultadoJob: unknown;
  ticketId?: string | null;
}): Promise<void> {
  const logId = logIdDesdeResultadoFactura(params.resultadoJob);
  if (!logId) return;

  const { data: row } = await params.db
    .from('lector_factura_log')
    .select('datos_extraidos')
    .eq('id', logId)
    .eq('tenant_id', params.tenantId)
    .eq('estado', 'extraido')
    .maybeSingle();

  if (!row || !logTieneBorradorWhatsapp(row.datos_extraidos)) return;

  const meta = metaDesdeDatosExtraidos(row.datos_extraidos);
  if (params.ticketId) meta.whatsappTicketId = params.ticketId;

  try {
    await persistirBorradorLectorFacturaWhatsapp({
      db: params.db,
      tenantId: params.tenantId,
      logId,
      resultadoJob: params.resultadoJob,
      meta,
    });
  } catch (e) {
    console.error('[borrador-whatsapp] sync failed', {
      tenantId: params.tenantId,
      logId,
      error: (e as Error).message,
    });
  }
}

export async function resolverBorradorUrlWhatsapp(params: {
  db: any;
  tenantId: string;
  snapshot: BorradorWhatsappSnapshot;
  resultado: unknown;
  meta?: BorradorWhatsappMeta;
}): Promise<string | null> {
  if (!requiereBorradorWebWhatsapp(params.snapshot)) return null;
  const logId = logIdDesdeResultadoFactura(params.resultado);
  if (!logId) return null;
  try {
    const { url } = await persistirBorradorLectorFacturaWhatsapp({
      db: params.db,
      tenantId: params.tenantId,
      logId,
      resultadoJob: params.resultado,
      meta: params.meta,
    });
    return url;
  } catch (e) {
    console.error('[borrador-whatsapp] persist failed', {
      tenantId: params.tenantId,
      logId,
      error: (e as Error).message,
    });
    return null;
  }
}
