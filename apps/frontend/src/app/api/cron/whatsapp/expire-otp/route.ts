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

function parseLimit(request: Request): number {
  const raw = Number.parseInt(new URL(request.url).searchParams.get('limit') ?? '500', 10);
  if (!Number.isFinite(raw)) return 500;
  return Math.max(1, Math.min(2000, raw));
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = createServiceRoleClient() as any;
  const limit = parseLimit(request);
  const nowIso = new Date().toISOString();

  const { data: expiredRows, error: selectErr } = await db
    .from('whatsapp_auth_challenge')
    .select('id')
    .eq('status', 'pending')
    .lt('expires_at', nowIso)
    .order('expires_at', { ascending: true })
    .limit(limit);

  if (selectErr) {
    return NextResponse.json({ error: selectErr.message }, { status: 500 });
  }

  const ids = (expiredRows ?? [])
    .map((row: { id?: string }) => String(row.id ?? '').trim())
    .filter(Boolean);
  if (ids.length === 0) {
    return NextResponse.json({ ok: true, scanned_limit: limit, expired: 0 });
  }

  const { error: updateErr } = await db
    .from('whatsapp_auth_challenge')
    .update({ status: 'expired' })
    .in('id', ids)
    .eq('status', 'pending');

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  console.info('[cron][whatsapp][expire-otp]', { expired: ids.length, scanned_limit: limit });
  return NextResponse.json({ ok: true, scanned_limit: limit, expired: ids.length });
}
