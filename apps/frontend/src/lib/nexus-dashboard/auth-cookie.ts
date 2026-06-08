import { createHmac, timingSafeEqual } from 'node:crypto';

export const NEXUS_DASHBOARD_COOKIE = 'nexus_dashboard_auth';

const SESSION_SECONDS = 60 * 60 * 8;

export function getNexusDashboardPassword(): string {
  return process.env.NEXUS_DASHBOARD_PASSWORD ?? 'nexus1819';
}

function getSigningSecret(): string {
  return (
    process.env.NEXUS_DASHBOARD_SECRET ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    'nexus-dashboard-dev-only-change-me'
  );
}

function toB64Url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url');
}

function fromB64Url(s: string): string {
  return Buffer.from(s, 'base64url').toString('utf8');
}

export function signNexusDashboardSession(): string {
  const exp = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const payload = JSON.stringify({ exp });
  const sig = createHmac('sha256', getSigningSecret()).update(payload).digest('hex');
  return `${toB64Url(payload)}.${sig}`;
}

export function verifyNexusDashboardSession(token: string | undefined): boolean {
  if (!token) return false;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return false;
  const payloadPart = token.slice(0, dot);
  const sigHex = token.slice(dot + 1);
  let payload: string;
  try {
    payload = fromB64Url(payloadPart);
  } catch {
    return false;
  }
  const expectedHex = createHmac('sha256', getSigningSecret()).update(payload).digest('hex');
  if (expectedHex.length !== sigHex.length) return false;
  try {
    if (!timingSafeEqual(Buffer.from(expectedHex, 'utf8'), Buffer.from(sigHex, 'utf8'))) {
      return false;
    }
  } catch {
    return false;
  }
  try {
    const parsed = JSON.parse(payload) as { exp?: number };
    return typeof parsed.exp === 'number' && parsed.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export function nexusDashboardCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_SECONDS,
  };
}
