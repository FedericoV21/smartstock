import { sendWhatsAppDocumentMessage, sendWhatsAppTextMessage } from '@/lib/whatsapp/send-message';

type OutboundRow = {
  id: string;
  tenant_id: string;
  to_wa_id: string;
  phone_number_id: string | null;
  body: string;
  message_type: string | null;
  document_link: string | null;
  document_filename: string | null;
  document_caption: string | null;
  status: string;
  retry_count: number | null;
  related_job_id: string | null;
};

export async function processWhatsAppOutboundQueue(params: {
  db: any;
  limit?: number;
  tenantId?: string;
  messageIds?: string[];
}) {
  const { db, tenantId } = params;
  const messageIds = Array.from(
    new Set((params.messageIds ?? []).map((id) => String(id ?? '').trim()).filter(Boolean)),
  );
  if (params.messageIds && messageIds.length === 0) {
    return { processed: 0, sent: 0, failed: 0 };
  }

  const requestedLimit = Math.max(1, Math.min(200, Number(params.limit ?? 100)));
  const limit = messageIds.length > 0 ? Math.min(requestedLimit, messageIds.length) : requestedLimit;

  const buildQuery = (withDocumentColumns: boolean) => {
    let query = db
      .from('whatsapp_outbound_message')
      .select(
        withDocumentColumns
          ? 'id, tenant_id, to_wa_id, phone_number_id, body, message_type, document_link, document_filename, document_caption, status, retry_count, related_job_id'
          : 'id, tenant_id, to_wa_id, phone_number_id, body, status, retry_count, related_job_id',
      )
      .eq('status', 'queued');
    if (tenantId) query = query.eq('tenant_id', tenantId);
    if (messageIds.length > 0) query = query.in('id', messageIds);
    query = query.order('created_at', { ascending: true }).limit(limit);
    return query;
  };

  const firstFetch = await buildQuery(true);
  let rows = firstFetch.data as OutboundRow[] | null;
  let error = firstFetch.error;

  if (error && /message_type|document_link|document_filename|document_caption/i.test(String(error.message ?? ''))) {
    const legacyFetch = await buildQuery(false);
    rows = ((legacyFetch.data ?? []) as any[]).map((row) => ({
      ...row,
      message_type: 'text',
      document_link: null,
      document_filename: null,
      document_caption: null,
    }));
    error = legacyFetch.error;
  }

  if (error) throw new Error(error.message);

  let processed = 0;
  let sent = 0;
  let failed = 0;

  for (const row of (rows ?? []) as OutboundRow[]) {
    const lock = await db
      .from('whatsapp_outbound_message')
      .update({ status: 'sending' })
      .eq('id', row.id)
      .eq('status', 'queued')
      .select('id')
      .maybeSingle();
    if (lock.error || !lock.data?.id) continue;

    processed += 1;

    try {
      const phoneNumberId = row.phone_number_id;
      if (!phoneNumberId) {
        throw new Error('phone_number_id faltante para envío outbound');
      }

      const messageType = String(row.message_type ?? 'text').trim().toLowerCase();
      const sentResp =
        messageType === 'document'
          ? await (async () => {
              const link = String(row.document_link ?? '').trim();
              if (!link) throw new Error('document_link faltante para envío outbound document');
              return sendWhatsAppDocumentMessage({
                phoneNumberId,
                toWaId: row.to_wa_id,
                link,
                filename: String(row.document_filename ?? '').trim() || null,
                caption: String(row.document_caption ?? '').trim() || null,
              });
            })()
          : await sendWhatsAppTextMessage({
              phoneNumberId,
              toWaId: row.to_wa_id,
              body: row.body,
            });

      await db
        .from('whatsapp_outbound_message')
        .update({
          to_wa_id: sentResp.resolvedToWaId ?? row.to_wa_id,
          status: 'sent',
          sent_at: new Date().toISOString(),
          external_message_id: sentResp.externalMessageId,
          last_error: null,
          last_error_at: null,
        })
        .eq('id', row.id);

      if (row.related_job_id) {
        await db.from('whatsapp_job_event').insert({
          tenant_id: row.tenant_id,
          job_id: row.related_job_id,
          event_type: 'outbound_sent',
          event_payload: { outbound_message_id: row.id, external_message_id: sentResp.externalMessageId },
        });
      }

      sent += 1;
    } catch (e) {
      const errorMessage = (e as Error).message;
      await db
        .from('whatsapp_outbound_message')
        .update({
          status: 'error',
          retry_count: (row.retry_count ?? 0) + 1,
          last_error: errorMessage,
          last_error_at: new Date().toISOString(),
        })
        .eq('id', row.id);

      if (row.related_job_id) {
        await db.from('whatsapp_job_event').insert({
          tenant_id: row.tenant_id,
          job_id: row.related_job_id,
          event_type: 'outbound_error',
          event_payload: { outbound_message_id: row.id, error: errorMessage },
        });
      }

      failed += 1;
    }
  }

  return { processed, sent, failed };
}
