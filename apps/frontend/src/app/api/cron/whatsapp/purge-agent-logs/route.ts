import { NextResponse } from 'next/server';

import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

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
  const nowIso = new Date().toISOString();

  const { count, error } = await db
    .from('whatsapp_agent_turn_log' as any)
    .delete({ count: 'exact' })
    .lt('expires_at', nowIso);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  console.info('[cron][whatsapp][purge-agent-logs]', { deleted: count ?? 0 });
  return NextResponse.json({ ok: true, deleted: count ?? 0 });
}
