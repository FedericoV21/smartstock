import { createHmac, timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import { getSupabaseServiceRoleKey } from '@/lib/supabase/env-keys';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

type ReportLinkPayload = {
  b: string;
  p: string;
  e: number;
};

function reportLinkSecret(): string {
  const direct = (process.env.WHATSAPP_REPORT_LINK_SECRET ?? '').trim();
  if (direct) return direct;
  return (process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? '').trim();
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function parseAndVerifyToken(rawToken: string): ReportLinkPayload | null {
  const secret = reportLinkSecret();
  if (!secret) return null;

  const parts = rawToken.split('.');
  if (parts.length !== 2) return null;
  const payloadB64 = parts[0];
  const signature = parts[1];

  const expected = createHmac('sha256', secret).update(payloadB64).digest('base64url');
  if (!constantTimeEquals(signature, expected)) return null;

  try {
    const json = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as Partial<ReportLinkPayload>;
    if (typeof parsed.b !== 'string' || typeof parsed.p !== 'string' || typeof parsed.e !== 'number') {
      return null;
    }
    return {
      b: parsed.b,
      p: parsed.p,
      e: parsed.e,
    };
  } catch {
    return null;
  }
}

function isAllowedBucket(bucket: string): boolean {
  return bucket === 'comprobantes';
}

function isSafeStoragePath(path: string): boolean {
  const normalized = path.trim();
  if (!normalized) return false;
  if (normalized.startsWith('/')) return false;
  if (normalized.includes('..')) return false;
  if (!normalized.includes('/')) return false;
  return true;
}

export async function GET(request: Request) {
  if (!getSupabaseServiceRoleKey()) {
    return NextResponse.json({ error: 'Service role key no configurada' }, { status: 503 });
  }

  const token = new URL(request.url).searchParams.get('t')?.trim();
  if (!token) {
    return NextResponse.json({ error: 'Token requerido' }, { status: 400 });
  }

  const payload = parseAndVerifyToken(token);
  if (!payload) {
    return NextResponse.json({ error: 'Token inválido' }, { status: 403 });
  }

  if (payload.e < Date.now()) {
    return NextResponse.json({ error: 'Enlace vencido' }, { status: 410 });
  }

  if (!isAllowedBucket(payload.b) || !isSafeStoragePath(payload.p)) {
    return NextResponse.json({ error: 'Enlace no permitido' }, { status: 403 });
  }

  const secondsRemaining = Math.trunc((payload.e - Date.now()) / 1000);
  const signTtl = Math.max(60, Math.min(60 * 60, secondsRemaining));

  const admin = createServiceRoleClient();
  const { data: signed, error } = await admin.storage.from(payload.b).createSignedUrl(payload.p, signTtl);

  if (error || !signed?.signedUrl) {
    return NextResponse.json({ error: 'No se pudo generar la descarga' }, { status: 404 });
  }

  return NextResponse.redirect(signed.signedUrl, 307);
}
