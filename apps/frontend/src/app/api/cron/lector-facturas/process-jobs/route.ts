import { NextResponse } from 'next/server';

import {
  leerArchivosLectorFacturaJob,
  parseJobArchivos,
  type LectorFacturaJobArchivo,
} from '@/lib/lector-facturas/jobs';
import {
  prepararConfirmacionLectorFacturaDesdeResultado,
} from '@/lib/lector-facturas/confirmacion-chatbot';
import { resolverBorradorUrlWhatsapp } from '@/lib/lector-facturas/borradores-whatsapp';
import { procesarFacturaIa } from '@/lib/lector-facturas/procesar-factura-ia';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { processWhatsAppOutboundQueue } from '@/lib/whatsapp/outbound-worker';
import {
  buildWhatsAppInvoiceTicketChatSummary,
  buildWhatsAppSandboxInvoiceTicketSnapshot,
  createOrReuseInvoiceAction,
  insertWhatsAppSandboxInvoiceTicket,
} from '@/lib/whatsapp/sandbox';

function pickOutboundIds(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  return data
    .map((row) => (row && typeof row === 'object' ? String((row as { id?: string }).id ?? '') : ''))
    .filter((id) => id.length > 0);
}

async function enqueueWhatsappOutboundAndFlush(params: {
  db: any;
  tenantId: string;
  toWaId: string;
  phoneNumberId: string | null;
  body: string;
  relatedJobId?: string | null;
}) {
  const payload: Record<string, unknown> = {
    tenant_id: params.tenantId,
    to_wa_id: params.toWaId,
    phone_number_id: params.phoneNumberId,
    body: params.body,
    status: 'queued',
  };
  if (params.relatedJobId) payload.related_job_id = params.relatedJobId;

  const insert = await params.db.from('whatsapp_outbound_message').insert(payload).select('id');
  if (insert?.error) {
    console.error('[lector-facturas][wa-notify] outbound insert error', insert.error.message);
    return;
  }

  const ids = pickOutboundIds(insert.data);
  if (ids.length === 0) return;

  try {
    await processWhatsAppOutboundQueue({
      db: params.db,
      tenantId: params.tenantId,
      limit: 20,
      messageIds: ids,
    });
  } catch (e) {
    console.error('[lector-facturas][wa-notify] outbound flush error', {
      tenantId: params.tenantId,
      error: (e as Error).message,
    });
  }
}

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function getCronSecret(): string {
  return (process.env.CRON_SECRET ?? '').trim();
}

function isAuthorized(request: Request): boolean {
  const secret = getCronSecret();
  if (!secret) return false;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

function formatAmount(value: unknown): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '$0,00';
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n);
}

function resumenWhatsapp(result: any): string {
  const items = Array.isArray(result?.items) ? result.items : [];
  const totalItems = items.length;
  const vinculados = items.filter((it: any) => it?.match?.producto_id).length;
  const revisar = items.filter((it: any) => it?.match?.requires_review).length;
  const advertencias = Array.isArray(result?.validacion?.advertencias)
    ? result.validacion.advertencias
    : [];
  const total = result?.totales?.total;
  const proveedor = result?.proveedor?.nombre ?? result?.crear_proveedor?.razon_social ?? null;

  const lines = [
    'Factura procesada con IA.',
    proveedor ? `Proveedor detectado: ${proveedor}` : null,
    `Items leidos: ${totalItems}. Vinculados: ${vinculados}. Para revisar: ${revisar}.`,
    total != null ? `Total: ${formatAmount(total)}` : null,
    advertencias.length > 0 ? `Advertencias: ${advertencias.slice(0, 2).join(' ')}` : null,
    'Ya esta disponible el JSON de preview para revisar antes de cargarlo.',
  ];
  return lines.filter(Boolean).join('\n');
}

async function notifyWhatsapp(params: {
  db: any;
  tenantId: string;
  whatsappJobId: string | null;
  lectorJobId: string;
  sucursalId: string | null;
  userId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}) {
  if (!params.whatsappJobId) return;
  const { data: waJob } = await params.db
    .from('whatsapp_processing_job')
    .select('id, from_wa_id, to_phone_number_id')
    .eq('id', params.whatsappJobId)
    .eq('tenant_id', params.tenantId)
    .maybeSingle();
  if (!waJob?.id) return;

  if (params.ok) {
    await params.db
      .from('whatsapp_processing_job')
      .update({
        status: 'imported',
        target_entity_type: 'lector_factura_job',
        target_entity_id: params.lectorJobId,
        error_code: null,
        error_detail: null,
        finished_at: new Date().toISOString(),
      })
      .eq('id', waJob.id);

    await params.db.from('whatsapp_job_event').insert({
      tenant_id: params.tenantId,
      job_id: waJob.id,
      event_type: 'lector_factura_job_completed',
      event_payload: {
        lector_factura_job_id: params.lectorJobId,
      },
    });

    if (waJob.from_wa_id) {
      let body = resumenWhatsapp(params.result);
      try {
        const prepared = await prepararConfirmacionLectorFacturaDesdeResultado({
          db: params.db,
          tenantId: params.tenantId,
          sucursalId: params.sucursalId,
          resultado: params.result,
        });
        const snapshot = buildWhatsAppSandboxInvoiceTicketSnapshot({
          resultado: params.result,
          prepared,
        });
        await params.db
          .from('lector_factura_job')
          .update({
            impacto_preview: prepared.impacto,
            impact_hash: prepared.impactHash,
            confirm_payload: prepared.confirmPayload,
            application_status: snapshot.status === 'ready' ? 'pending' : 'blocked',
            applied_error: snapshot.status === 'ready' ? null : snapshot.blockingReasons.join(' | '),
          })
          .eq('id', params.lectorJobId)
          .eq('tenant_id', params.tenantId);

        const { data: actor } = await params.db
          .from('whatsapp_actor')
          .select('id, usuario_id, rol_whatsapp, trust_level, activo')
          .eq('tenant_id', params.tenantId)
          .eq('from_wa_id', waJob.from_wa_id)
          .eq('activo', true)
          .order('verified_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const canConfirm =
          actor?.id &&
          actor.trust_level === 'verified' &&
          actor.rol_whatsapp !== 'readonly' &&
          snapshot.status === 'ready';

        let token: string | null = null;
        let actionId: string | null = null;
        if (canConfirm) {
          const action = await createOrReuseInvoiceAction({
            db: params.db,
            tenantId: params.tenantId,
            actorId: String(actor.id),
            fromWaId: String(waJob.from_wa_id),
            lectorJobId: params.lectorJobId,
            impactHash: prepared.impactHash,
          });
          token = action.token;
          actionId = action.actionId;
        }

        if (actor?.id) {
          const ticket = await insertWhatsAppSandboxInvoiceTicket({
            db: params.db,
            tenantId: params.tenantId,
            userId: String(actor.usuario_id ?? params.userId),
            actorId: String(actor.id),
            fromWaId: String(waJob.from_wa_id),
            lectorFacturaJobId: params.lectorJobId,
            actionLogId: actionId,
            snapshot,
          });
          const borradorUrl = await resolverBorradorUrlWhatsapp({
            db: params.db,
            tenantId: params.tenantId,
            snapshot,
            resultado: params.result,
            meta: {
              lectorFacturaJobId: params.lectorJobId,
              whatsappTicketId: ticket.id,
            },
          });
          body = buildWhatsAppInvoiceTicketChatSummary(ticket, token, borradorUrl);
          if (actor.trust_level !== 'verified') {
            body = `${body}\n\nTu numero todavia no esta verificado, por eso no puedo aceptar la carga desde WhatsApp.`;
          } else if (actor.rol_whatsapp === 'readonly') {
            body = `${body}\n\nTu rol de WhatsApp es solo lectura, por eso no puedo aceptar la carga desde este chat.`;
          }
        } else {
          body = `${body}\nNo pude abrir un ticket conversacional porque este numero no tiene actor de WhatsApp vinculado.`;
        }
      } catch (e) {
        body = `${body}\nNo pude preparar la confirmacion automatica: ${(e as Error).message}`;
      }

      await enqueueWhatsappOutboundAndFlush({
        db: params.db,
        tenantId: params.tenantId,
        toWaId: waJob.from_wa_id,
        phoneNumberId: waJob.to_phone_number_id ?? null,
        body,
        relatedJobId: waJob.id,
      });
    }
    return;
  }

  await params.db
    .from('whatsapp_processing_job')
    .update({
      status: 'error',
      target_entity_type: 'lector_factura_job',
      target_entity_id: params.lectorJobId,
      error_code: 'lector_factura_job_failed',
      error_detail: params.error ?? 'Error procesando factura IA',
      finished_at: new Date().toISOString(),
    })
    .eq('id', waJob.id);

  await params.db.from('whatsapp_job_event').insert({
    tenant_id: params.tenantId,
    job_id: waJob.id,
    event_type: 'lector_factura_job_failed',
    event_payload: {
      lector_factura_job_id: params.lectorJobId,
      error: params.error,
    },
  });

  if (waJob.from_wa_id) {
    await enqueueWhatsappOutboundAndFlush({
      db: params.db,
      tenantId: params.tenantId,
      toWaId: waJob.from_wa_id,
      phoneNumberId: waJob.to_phone_number_id ?? null,
      body: `No pude procesar la factura con IA: ${params.error ?? 'error desconocido'}`,
      relatedJobId: waJob.id,
    });
  }
}

async function sendCallback(params: {
  db: any;
  jobId: string;
  callbackUrl: string | null;
  payload: Record<string, unknown>;
}) {
  if (!params.callbackUrl) return;
  try {
    const response = await fetch(params.callbackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params.payload),
      signal: AbortSignal.timeout(10_000),
    });
    await params.db
      .from('lector_factura_job')
      .update({
        callback_status: response.ok ? 'sent' : 'error',
        callback_error: response.ok ? null : `HTTP ${response.status}`,
        callback_sent_at: new Date().toISOString(),
      })
      .eq('id', params.jobId);
  } catch (e) {
    await params.db
      .from('lector_factura_job')
      .update({
        callback_status: 'error',
        callback_error: (e as Error).message,
        callback_sent_at: new Date().toISOString(),
      })
      .eq('id', params.jobId);
  }
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = createServiceRoleClient() as any;
  const { data: jobs, error } = await db
    .from('lector_factura_job')
    .select(
      'id, tenant_id, sucursal_id, usuario_id, source, status, callback_url, archivos, retry_count, whatsapp_processing_job_id',
    )
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(10);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let processed = 0;
  let completed = 0;
  let failed = 0;

  for (const job of jobs ?? []) {
    const lock = await db
      .from('lector_factura_job')
      .update({ status: 'processing', started_at: new Date().toISOString() })
      .eq('id', job.id)
      .eq('status', 'queued')
      .select('id')
      .maybeSingle();
    if (lock.error || !lock.data?.id) continue;
    processed += 1;

    try {
      const archivosMeta = parseJobArchivos(job.archivos) as LectorFacturaJobArchivo[];
      if (archivosMeta.length === 0) throw new Error('Job sin archivos validos');

      const archivos = await leerArchivosLectorFacturaJob({ db, archivos: archivosMeta });
      const result = await procesarFacturaIa({
        supabase: db,
        tenantId: job.tenant_id,
        userId: job.usuario_id,
        archivos,
        source: job.source === 'whatsapp' ? 'whatsapp' : 'api_publica',
        aplicarRateLimit: false,
      });

      if (!result.ok) {
        failed += 1;
        await db
          .from('lector_factura_job')
          .update({
            status: 'failed',
            retry_count: (job.retry_count ?? 0) + 1,
            error_code: `http_${result.status}`,
            error_detail: result.error,
            finished_at: new Date().toISOString(),
          })
          .eq('id', job.id);

        await notifyWhatsapp({
          db,
          tenantId: job.tenant_id,
          whatsappJobId: job.whatsapp_processing_job_id,
          lectorJobId: job.id,
          sucursalId: job.sucursal_id,
          userId: job.usuario_id,
          ok: false,
          error: result.error,
        });

        await sendCallback({
          db,
          jobId: job.id,
          callbackUrl: job.callback_url,
          payload: {
            job_id: job.id,
            status: 'failed',
            error: { code: `http_${result.status}`, message: result.error },
          },
        });
        continue;
      }

      const payload = { ...result.payload, job_id: job.id };
      await db
        .from('lector_factura_job')
        .update({
          status: 'completed',
          lector_factura_log_id: result.payload.log_id,
          resultado: payload,
          error_code: null,
          error_detail: null,
          finished_at: new Date().toISOString(),
        })
        .eq('id', job.id);

      await notifyWhatsapp({
        db,
        tenantId: job.tenant_id,
        whatsappJobId: job.whatsapp_processing_job_id,
        lectorJobId: job.id,
        sucursalId: job.sucursal_id,
        userId: job.usuario_id,
        ok: true,
        result: payload,
      });

      await sendCallback({
        db,
        jobId: job.id,
        callbackUrl: job.callback_url,
        payload: {
          job_id: job.id,
          status: 'completed',
          result: payload,
        },
      });

      completed += 1;
    } catch (e) {
      failed += 1;
      const message = (e as Error).message;
      await db
        .from('lector_factura_job')
        .update({
          status: 'failed',
          retry_count: (job.retry_count ?? 0) + 1,
          error_code: 'worker_error',
          error_detail: message,
          finished_at: new Date().toISOString(),
        })
        .eq('id', job.id);

      await notifyWhatsapp({
        db,
        tenantId: job.tenant_id,
        whatsappJobId: job.whatsapp_processing_job_id,
        lectorJobId: job.id,
        sucursalId: job.sucursal_id,
        userId: job.usuario_id,
        ok: false,
        error: message,
      });

      await sendCallback({
        db,
        jobId: job.id,
        callbackUrl: job.callback_url,
        payload: {
          job_id: job.id,
          status: 'failed',
          error: { code: 'worker_error', message },
        },
      });
    }
  }

  return NextResponse.json({ ok: true, processed, completed, failed });
}
