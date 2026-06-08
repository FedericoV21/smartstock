import { NextResponse } from 'next/server';

import { createServiceRoleClient } from '@/lib/supabase/server';

function getCronSecret(): string {
  return (process.env.CRON_SECRET ?? '').trim();
}

function isAuthorized(request: Request): boolean {
  const secret = getCronSecret();
  if (!secret) return false;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 400 });
  }

  const db = createServiceRoleClient() as any;
  const { data: job, error } = await db
    .from('whatsapp_processing_job')
    .select('id, tenant_id, status')
    .eq('id', id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!job?.id) return NextResponse.json({ error: 'Job no encontrado' }, { status: 404 });

  await db
    .from('whatsapp_processing_job')
    .update({
      status: 'queued',
      error_code: null,
      error_detail: null,
      started_at: null,
      finished_at: null,
    })
    .eq('id', id);

  await db.from('whatsapp_job_event').insert({
    tenant_id: job.tenant_id,
    job_id: id,
    event_type: 'manual_reprocess_requested',
    event_payload: { previous_status: job.status },
  });

  return NextResponse.json({ ok: true, job_id: id, status: 'queued' });
}
