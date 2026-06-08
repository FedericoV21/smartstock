import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { moduloGuardAny } from '@/lib/modulos/guard';
import { MODULOS_ACCESO_LECTOR_FACTURAS } from '@/lib/modulos/modulo-key';

export async function GET(request: Request) {
  const guard = await moduloGuardAny([...MODULOS_ACCESO_LECTOR_FACTURAS, 'importador_excel']);
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const url = new URL(request.url);
  const limitRaw = Number.parseInt(url.searchParams.get('limit') ?? '50', 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50;

  const { data, error } = await session.supabase
    .from('whatsapp_processing_job' as any)
    .select(
      'id, status, document_type, branch_resolution_status, branch_resolution_reason, error_code, error_detail, created_at, started_at, finished_at, retry_count, last_error_at, target_entity_type, target_entity_id, whatsapp_inbound_message(wamid, from_wa_id, message_type, text_body, received_at), whatsapp_inbound_attachment(mime_type, filename, storage_bucket, storage_path, archivo_tamano)',
    )
    .eq('tenant_id', session.tenantId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ jobs: data ?? [] });
}

export async function POST(request: Request) {
  const guard = await moduloGuardAny([...MODULOS_ACCESO_LECTOR_FACTURAS, 'importador_excel']);
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const b =
    body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const action = String(b.action ?? '').trim();
  const jobId = String(b.job_id ?? '').trim();
  if (action !== 'reprocess' || !jobId) {
    return NextResponse.json({ error: 'Parámetros inválidos' }, { status: 400 });
  }

  const { data: jobRow, error: getErr } = await session.supabase
    .from('whatsapp_processing_job' as any)
    .select('id, tenant_id, status, document_type, branch_id, branch_resolution_status')
    .eq('id', jobId)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();

  if (getErr) return NextResponse.json({ error: getErr.message }, { status: 500 });

  const job = jobRow as {
    id: string;
    tenant_id: string;
    status: string;
    document_type: string | null;
    branch_id: string | null;
    branch_resolution_status: string | null;
  } | null;
  if (!job?.id) return NextResponse.json({ error: 'Job no encontrado' }, { status: 404 });

  const docType = String(job.document_type ?? '').toLowerCase();
  const isVoice = docType === 'voice_note' || docType === 'voice' || docType === 'audio';
  const needsBranch = !isVoice && docType !== 'unsupported';

  if (
    needsBranch &&
    !job.branch_id &&
    (job.status === 'awaiting_branch_confirmation' || job.branch_resolution_status === 'ambiguous')
  ) {
    return NextResponse.json(
      {
        error:
          'Este archivo necesita sucursal confirmada. Respondé por WhatsApp con el número de sucursal o configurá una regla en el panel.',
      },
      { status: 400 },
    );
  }

  const updatePayload: Record<string, unknown> = {
    status: 'queued',
    error_code: null,
    error_detail: null,
    started_at: null,
    finished_at: null,
  };

  if (isVoice && job.status === 'awaiting_branch_confirmation') {
    updatePayload.branch_resolution_status = null;
    updatePayload.branch_resolution_reason = 'not_required_audio_stt';
    updatePayload.branch_prompt_deadline_at = null;
    updatePayload.branch_prompt_requested_at = null;
  }

  const { error: upErr } = await session.supabase
    .from('whatsapp_processing_job' as any)
    .update(updatePayload)
    .eq('id', job.id)
    .eq('tenant_id', session.tenantId);

  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  await session.supabase.from('whatsapp_job_event' as any).insert({
    tenant_id: session.tenantId,
    job_id: job.id,
    event_type: 'manual_reprocess_requested_ui',
    event_payload: { previous_status: job.status, requested_by: session.userId },
  });

  return NextResponse.json({ ok: true, job_id: job.id, status: 'queued' });
}
