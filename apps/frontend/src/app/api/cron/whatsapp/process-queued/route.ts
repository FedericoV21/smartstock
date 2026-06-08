import { NextResponse } from 'next/server';

import { createServiceRoleClient } from '@/lib/supabase/server';
import { runWhatsAppProcessQueuedJobs } from '@/lib/whatsapp/process-queued-runner';

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

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = createServiceRoleClient() as any;
  const result = await runWhatsAppProcessQueuedJobs(db);
  return NextResponse.json({ ok: true, ...result });
}
