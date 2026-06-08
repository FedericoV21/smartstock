import { createHmac, timingSafeEqual } from 'node:crypto';

export type ReportLinkPayload = {
  b: string;
  p: string;
  e: number;
};

export function reportLinkSecret(env: NodeJS.ProcessEnv): string {
  const direct = (env.WHATSAPP_REPORT_LINK_SECRET ?? '').trim();
  if (direct) return direct;
  return (env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? '').trim();
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function parseAndVerifyReportToken(rawToken: string, secret: string): ReportLinkPayload | null {
  if (!secret) return null;

  const parts = rawToken.split('.');
  if (parts.length !== 2) return null;
  const payloadB64 = parts[0]!;
  const signature = parts[1]!;

  const expected = createHmac('sha256', secret).update(payloadB64).digest('base64url');
  if (!constantTimeEquals(signature, expected)) return null;

  try {
    const json = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as Partial<ReportLinkPayload>;
    if (typeof parsed.b !== 'string' || typeof parsed.p !== 'string' || typeof parsed.e !== 'number') {
      return null;
    }
    return { b: parsed.b, p: parsed.p, e: parsed.e };
  } catch {
    return null;
  }
}

export function isAllowedReportBucket(bucket: string): boolean {
  return bucket === 'comprobantes';
}

export function isSafeStoragePath(path: string): boolean {
  const normalized = path.trim();
  if (!normalized) return false;
  if (normalized.startsWith('/')) return false;
  if (normalized.includes('..')) return false;
  if (!normalized.includes('/')) return false;
  return true;
}
