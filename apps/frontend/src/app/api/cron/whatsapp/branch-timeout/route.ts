import { NextResponse } from 'next/server';

import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

function getCronSecret(): string {
  return (process.env.CRON_SECRET ?? '').trim();
}

function isAuthorized(request: Request): boolean {
  const secret = getCronSecret();
  if (!secret) return false;

  const auth = request.headers.get('authorization') ?? '';
  return auth === `Bearer ${secret}`;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createServiceRoleClient() as any;
  const nowIso = new Date().toISOString();

  const { data: jobs, error } = await admin
    .from('whatsapp_processing_job')
    .select('id, tenant_id')
    .eq('status', 'awaiting_branch_confirmation')
    .lte('branch_prompt_deadline_at', nowIso)
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = jobs ?? [];
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, updated: 0 });
  }

  const ids = rows.map((j: { id: string }) => j.id);
  const { error: upErr } = await admin
    .from('whatsapp_processing_job')
    .update({
      status: 'review_required',
      branch_resolution_reason: 'branch_confirmation_timeout',
    })
    .in('id', ids);

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  const events = rows.map((j: { id: string; tenant_id: string }) => ({
    tenant_id: j.tenant_id,
    job_id: j.id,
    event_type: 'branch_confirmation_timeout',
    event_payload: { timeout_at: nowIso },
  }));

  await admin.from('whatsapp_job_event').insert(events);

  return NextResponse.json({ ok: true, updated: ids.length });
}
