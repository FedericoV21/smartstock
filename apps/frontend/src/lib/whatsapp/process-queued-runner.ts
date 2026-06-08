import { resolveWhatsAppJobRoute } from '@/lib/whatsapp/job-routing';
import { downloadWhatsAppMedia, fetchWhatsAppMediaMetadata } from '@/lib/whatsapp/meta-media';
import { transcribeWhatsAppAudio } from '@/lib/whatsapp/stt';
import { uploadWhatsAppAttachmentToStorage } from '@/lib/whatsapp/storage';
import { getWhatsAppAgentFeatureFlag } from '@/lib/whatsapp/feature-flag';
import { handleWhatsAppTextMessage } from '@/lib/whatsapp/text-handler';
import { processWhatsAppOutboundQueue } from '@/lib/whatsapp/outbound-worker';
import { postInternalCron } from '@/lib/internal-cron';
import { crearLectorFacturaJob } from '@/lib/lector-facturas/jobs';

const JOB_SELECT =
  'id, tenant_id, inbound_message_id, inbound_attachment_id, from_wa_id, to_phone_number_id, document_type, branch_id, status, retry_count, whatsapp_inbound_attachment(id, mime_type, filename, wa_media_id, raw_payload, storage_bucket, storage_path, archivo_tamano)';

async function pickAutomationUserId(db: any, tenantId: string): Promise<string | null> {
  const { data: user } = await db
    .from('usuario')
    .select('id')
    .eq('tenant_id', tenantId)
    .in('rol', ['admin', 'operador'])
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return user?.id ?? null;
}

async function ensureAttachmentDownloaded(params: {
  db: any;
  tenantId: string;
  inboundAttachmentId: string;
  attachment: any;
}) {
  const { db, tenantId, inboundAttachmentId, attachment } = params;
  if (!attachment) throw new Error('Attachment no encontrado');

  const storagePath = attachment.storage_path as string | null;
  const storageBucket = attachment.storage_bucket as string | null;
  if (storagePath && storageBucket) {
    return {
      storageBucket,
      storagePath,
      mimeType: (attachment.mime_type as string | null) ?? null,
      fileSize: (attachment.archivo_tamano as number | null) ?? null,
      filename: (attachment.filename as string | null) ?? null,
    };
  }

  const mediaId = attachment.wa_media_id as string | null;
  if (!mediaId) throw new Error('wa_media_id faltante');

  const metadata = await fetchWhatsAppMediaMetadata(mediaId);
  const media = await downloadWhatsAppMedia(metadata.url);
  const mimeType = (attachment.mime_type as string | null) ?? metadata.mime_type ?? media.contentType;
  const fileSize = media.contentLength ?? metadata.file_size ?? media.bytes.byteLength;
  const filename = (attachment.filename as string | null) ?? 'whatsapp-file';

  const uploaded = await uploadWhatsAppAttachmentToStorage({
    db,
    tenantId,
    bytes: media.bytes,
    mimeType,
    filename,
  });

  await db
    .from('whatsapp_inbound_attachment')
    .update({
      storage_bucket: uploaded.bucket,
      storage_path: uploaded.path,
      archivo_tamano: fileSize,
      download_status: 'downloaded',
      downloaded_at: new Date().toISOString(),
      download_error: null,
    })
    .eq('id', inboundAttachmentId);

  return {
    storageBucket: uploaded.bucket,
    storagePath: uploaded.path,
    mimeType,
    fileSize,
    filename,
  };
}

async function readAttachmentBytesFromStorage(params: {
  db: any;
  storageBucket: string;
  storagePath: string;
}): Promise<ArrayBuffer> {
  const { db, storageBucket, storagePath } = params;
  const { data, error } = await db.storage.from(storageBucket).download(storagePath);
  if (error || !data) {
    throw new Error(error?.message ?? 'No se pudo leer el adjunto desde Storage');
  }
  return await data.arrayBuffer();
}

function isAudioDocumentType(documentType: string | null | undefined): boolean {
  const t = String(documentType ?? '').toLowerCase();
  return t === 'audio' || t === 'voice' || t === 'voice_note';
}

function isMediaDocumentType(documentType: string | null | undefined): boolean {
  const t = String(documentType ?? '').toLowerCase();
  return t === 'image' || t === 'document' || t === 'factura_media';
}

function inferMimeTypeForJob(params: {
  mimeType: string | null;
  documentType: string | null | undefined;
}): string | null {
  const mime = (params.mimeType ?? '').trim();
  if (mime) return mime;
  const docType = String(params.documentType ?? '').toLowerCase();
  if (docType === 'image') return 'image/jpeg';
  if (docType === 'document') return 'application/pdf';
  return null;
}

async function enqueueJobOutbound(params: {
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

  const insert = await params.db.from('whatsapp_outbound_message' as any).insert(payload).select('id');
  if (insert?.error) return;

  const ids = (Array.isArray(insert.data) ? insert.data : [])
    .map((row: { id?: string }) => String(row?.id ?? ''))
    .filter((id: string) => id.length > 0);

  if (ids.length === 0) return;

  try {
    await processWhatsAppOutboundQueue({
      db: params.db,
      tenantId: params.tenantId,
      limit: 20,
      messageIds: ids,
    });
  } catch (e) {
    console.error('[wa-process-queued] outbound flush error', {
      tenantId: params.tenantId,
      error: (e as Error).message,
    });
  }
}

export type ProcessQueuedJobsResult = {
  processed: number;
  routed: number;
  failed: number;
  recovered: number;
};

const STALE_PROCESSING_MS = 8 * 60 * 1000;

async function recoverStaleWhatsAppProcessingJobs(db: any): Promise<number> {
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS).toISOString();
  let recovered = 0;

  const { data: staleUntargeted, error: untargetedErr } = await db
    .from('whatsapp_processing_job')
    .select('id, tenant_id')
    .eq('status', 'processing')
    .is('target_entity_id', null)
    .lt('started_at', staleBefore);

  if (untargetedErr) {
    console.error('[wa-process-queued] stale untargeted query', untargetedErr.message);
  } else {
    for (const row of staleUntargeted ?? []) {
      const { error } = await db
        .from('whatsapp_processing_job')
        .update({
          status: 'queued',
          started_at: null,
          error_code: 'stale_processing_recovered',
          error_detail: 'Reencolado tras timeout del worker',
        })
        .eq('id', row.id)
        .eq('status', 'processing');

      if (!error) {
        recovered += 1;
        await db.from('whatsapp_job_event').insert({
          tenant_id: row.tenant_id,
          job_id: row.id,
          event_type: 'stale_processing_requeued',
          event_payload: { reason: 'untargeted_timeout' },
        });
      }
    }
  }

  const { data: staleFactura, error: facturaErr } = await db
    .from('whatsapp_processing_job')
    .select('id, tenant_id, target_entity_id')
    .eq('status', 'processing')
    .eq('target_entity_type', 'lector_factura_job')
    .not('target_entity_id', 'is', null)
    .lt('started_at', staleBefore);

  if (facturaErr) {
    console.error('[wa-process-queued] stale factura query', facturaErr.message);
    return recovered;
  }

  for (const row of staleFactura ?? []) {
    const lectorId = row.target_entity_id as string;
    const { data: lector } = await db
      .from('lector_factura_job')
      .select('status')
      .eq('id', lectorId)
      .maybeSingle();

    if (lector?.status === 'queued') {
      void postInternalCron('/api/cron/lector-facturas/process-jobs');
      continue;
    }

    if (lector?.status === 'completed') {
      const { error } = await db
        .from('whatsapp_processing_job')
        .update({
          status: 'imported',
          error_code: null,
          error_detail: null,
          finished_at: new Date().toISOString(),
        })
        .eq('id', row.id)
        .eq('status', 'processing');
      if (!error) recovered += 1;
      continue;
    }

    if (lector?.status === 'failed') {
      const { error } = await db
        .from('whatsapp_processing_job')
        .update({
          status: 'error',
          error_code: 'lector_factura_job_failed',
          error_detail: 'Lector finalizó en error; sincronizado por recovery',
          finished_at: new Date().toISOString(),
        })
        .eq('id', row.id)
        .eq('status', 'processing');
      if (!error) recovered += 1;
    }
  }

  return recovered;
}

export async function runWhatsAppProcessQueuedJobs(
  db: any,
  params?: { tenantId?: string; jobIds?: string[]; limit?: number },
): Promise<ProcessQueuedJobsResult> {
  const limit = Math.min(Math.max(params?.limit ?? 50, 1), 50);
  const recovered = await recoverStaleWhatsAppProcessingJobs(db);

  let query = db
    .from('whatsapp_processing_job')
    .select(JOB_SELECT)
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(limit);

  if (params?.tenantId) {
    query = query.eq('tenant_id', params.tenantId);
  }
  if (params?.jobIds?.length) {
    query = query.in('id', params.jobIds);
  }

  const { data: jobs, error } = await query;
  if (error) throw new Error(error.message);

  let processed = 0;
  let routed = 0;
  let failed = 0;

  for (const job of jobs ?? []) {
    const lock = await db
      .from('whatsapp_processing_job')
      .update({ status: 'processing', started_at: new Date().toISOString() })
      .eq('id', job.id)
      .eq('status', 'queued')
      .select('id')
      .maybeSingle();

    if (lock.error || !lock.data?.id) continue;
    processed += 1;

    const attachment = Array.isArray(job.whatsapp_inbound_attachment)
      ? job.whatsapp_inbound_attachment[0]
      : job.whatsapp_inbound_attachment;

    try {
      const downloaded = await ensureAttachmentDownloaded({
        db,
        tenantId: job.tenant_id,
        inboundAttachmentId: job.inbound_attachment_id,
        attachment,
      });
      const mimeType = inferMimeTypeForJob({
        mimeType: downloaded.mimeType,
        documentType: job.document_type,
      });
      const route = resolveWhatsAppJobRoute(mimeType);

      if (route.flow === 'unsupported') {
        await db
          .from('whatsapp_processing_job')
          .update({
            status: 'review_required',
            document_type: route.documentType,
            error_code: 'unsupported_mime',
            error_detail: `MIME no soportado: ${mimeType ?? 'desconocido'}`,
            finished_at: new Date().toISOString(),
          })
          .eq('id', job.id);
        await db.from('whatsapp_job_event').insert({
          tenant_id: job.tenant_id,
          job_id: job.id,
          event_type: 'routing_unsupported',
          event_payload: { mime_type: mimeType },
        });
        if (job.from_wa_id) {
          await enqueueJobOutbound({
            db,
            tenantId: job.tenant_id,
            toWaId: job.from_wa_id,
            phoneNumberId: job.to_phone_number_id ?? null,
            body:
              'Recibí tu archivo, pero el formato no es compatible. Enviá la factura como foto JPG/PNG, PDF o una nota de voz.',
            relatedJobId: job.id,
          });
        }
        continue;
      }

      if (route.flow === 'audio_transcription') {
        const featureFlag = await getWhatsAppAgentFeatureFlag(db, job.tenant_id);
        if (!featureFlag.enabled) {
          await db
            .from('whatsapp_processing_job')
            .update({
              status: 'review_required',
              document_type: route.documentType,
              error_code: 'feature_disabled',
              error_detail: 'whatsapp_agent_feature_flag_disabled',
              finished_at: new Date().toISOString(),
            })
            .eq('id', job.id);

          await db.from('whatsapp_job_event').insert({
            tenant_id: job.tenant_id,
            job_id: job.id,
            event_type: 'audio_stt_skipped_feature_disabled',
            event_payload: { rollout_stage: featureFlag.rolloutStage },
          });

          if (job.from_wa_id) {
            await enqueueJobOutbound({
              db,
              tenantId: job.tenant_id,
              toWaId: job.from_wa_id,
              phoneNumberId: job.to_phone_number_id ?? null,
              body: 'El asistente por voz no está activo para este negocio. Escribí tu consulta por texto.',
              relatedJobId: job.id,
            });
          }
          continue;
        }

        if (!downloaded.storageBucket || !downloaded.storagePath) {
          throw new Error('Audio sin referencia de storage para transcripción');
        }
        if (!job.from_wa_id || !job.inbound_message_id) {
          throw new Error('Faltan referencias del mensaje para transcripción de audio');
        }

        const bytes = await readAttachmentBytesFromStorage({
          db,
          storageBucket: downloaded.storageBucket,
          storagePath: downloaded.storagePath,
        });
        const stt = await transcribeWhatsAppAudio({
          bytes,
          mimeType,
          filename: downloaded.filename,
        });

        await handleWhatsAppTextMessage({
          db,
          tenantId: job.tenant_id,
          fromWaId: job.from_wa_id,
          phoneNumberId: job.to_phone_number_id ?? null,
          inboundMessageId: job.inbound_message_id,
          textBody: stt.text,
          source: 'audio_stt',
        });

        await db
          .from('whatsapp_processing_job')
          .update({
            status: 'imported',
            document_type: route.documentType,
            target_entity_type: 'whatsapp_text_agent',
            target_entity_id: null,
            error_code: null,
            error_detail: null,
            finished_at: new Date().toISOString(),
          })
          .eq('id', job.id);

        await db.from('whatsapp_job_event').insert({
          tenant_id: job.tenant_id,
          job_id: job.id,
          event_type: 'routed_to_audio_stt',
          event_payload: {
            provider: stt.provider,
            model: stt.model,
            transcript_excerpt: stt.text.slice(0, 280),
            mime_type: mimeType,
          },
        });
        routed += 1;
        continue;
      }

      if (!job.branch_id) {
        throw new Error('branch_id faltante para procesar adjunto no-audio');
      }

      const userId = await pickAutomationUserId(db, job.tenant_id);
      if (!userId) throw new Error('No hay usuario admin/operador para registrar operación');

      if (route.flow === 'lector_facturas') {
        if (!downloaded.storageBucket || !downloaded.storagePath) {
          throw new Error('Adjunto sin referencia de storage para lector de facturas');
        }

        const lectorJob = await crearLectorFacturaJob({
          db,
          tenantId: job.tenant_id,
          sucursalId: job.branch_id,
          userId,
          source: 'whatsapp',
          whatsappProcessingJobId: job.id,
          externalId: job.id,
          idempotencyKey: job.inbound_attachment_id,
          archivos: [
            {
              nombre: downloaded.filename ?? attachment?.filename ?? 'whatsapp-document',
              mimeType: mimeType ?? 'application/octet-stream',
              size: downloaded.fileSize ?? 0,
              storageBucket: downloaded.storageBucket,
              storagePath: downloaded.storagePath,
            },
          ],
        });

        await db
          .from('whatsapp_processing_job')
          .update({
            status: 'processing',
            document_type: route.documentType,
            target_entity_type: 'lector_factura_job',
            target_entity_id: lectorJob.id,
            error_code: null,
            error_detail: null,
          })
          .eq('id', job.id);

        await db.from('whatsapp_job_event').insert({
          tenant_id: job.tenant_id,
          job_id: job.id,
          event_type: 'routed_to_lector_factura_job',
          event_payload: {
            lector_factura_job_id: lectorJob.id,
            mime_type: mimeType,
            storage_bucket: downloaded.storageBucket,
            storage_path: downloaded.storagePath,
          },
        });

        if (job.from_wa_id) {
          await enqueueJobOutbound({
            db,
            tenantId: job.tenant_id,
            toWaId: job.from_wa_id,
            phoneNumberId: job.to_phone_number_id ?? null,
            body: 'Recibí la factura, la estoy procesando con IA. Te aviso cuando tenga el preview listo.',
            relatedJobId: job.id,
          });
        }

        void postInternalCron('/api/cron/lector-facturas/process-jobs');
        routed += 1;
        continue;
      }

      const { data: impRow, error: impErr } = await db
        .from('importacion_log')
        .insert({
          tenant_id: job.tenant_id,
          proveedor_id: null,
          archivo_nombre: attachment?.filename ?? 'whatsapp-lista',
          origen: 'importacion_excel',
          total_filas: 0,
          filas_exitosas: 0,
          filas_con_error: 0,
          productos_creados: 0,
          productos_actualizados: 0,
          detalle_errores: null,
          usuario_id: userId,
          sucursal_id: job.branch_id,
          archivo_storage_path: downloaded.storagePath,
          archivo_mime: mimeType,
          archivo_tamano: downloaded.fileSize,
        })
        .select('id')
        .single();

      if (impErr) throw new Error(impErr.message);

      await db
        .from('whatsapp_processing_job')
        .update({
          status: 'review_required',
          document_type: route.documentType,
          target_entity_type: 'importacion_log',
          target_entity_id: impRow.id,
          finished_at: new Date().toISOString(),
        })
        .eq('id', job.id);

      await db.from('whatsapp_job_event').insert({
        tenant_id: job.tenant_id,
        job_id: job.id,
        event_type: 'routed_to_importador',
        event_payload: { importacion_log_id: impRow.id, mime_type: mimeType },
      });
      routed += 1;
    } catch (e) {
      failed += 1;

      await db
        .from('whatsapp_processing_job')
        .update({
          status: 'error',
          retry_count: (job.retry_count ?? 0) + 1,
          error_code: 'routing_failed',
          error_detail: (e as Error).message,
          last_error_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
        })
        .eq('id', job.id);

      await db.from('whatsapp_job_event').insert({
        tenant_id: job.tenant_id,
        job_id: job.id,
        event_type: 'routing_error',
        event_payload: { error: (e as Error).message },
      });

      if (!job.from_wa_id) continue;

      if (isAudioDocumentType(job.document_type)) {
        await enqueueJobOutbound({
          db,
          tenantId: job.tenant_id,
          toWaId: job.from_wa_id,
          phoneNumberId: job.to_phone_number_id ?? null,
          body: 'No pude transcribir tu audio en este intento. Probá con un audio más corto o escribime por texto.',
          relatedJobId: job.id,
        });
        continue;
      }

      if (isMediaDocumentType(job.document_type)) {
        await enqueueJobOutbound({
          db,
          tenantId: job.tenant_id,
          toWaId: job.from_wa_id,
          phoneNumberId: job.to_phone_number_id ?? null,
          body: `No pude procesar tu archivo en este intento: ${(e as Error).message}. Probá reenviarlo o contactá al administrador.`,
          relatedJobId: job.id,
        });
      }
    }
  }

  return { processed, routed, failed, recovered };
}
