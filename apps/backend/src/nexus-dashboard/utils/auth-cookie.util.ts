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

export function nexusDashboardCookieOptions(): {
  httpOnly: boolean;
  sameSite: 'lax';
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_SECONDS,
  };
}

export function parseCookieHeader(header: string | undefined): Record<string, string> {
  if (!header?.trim()) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function buildSetCookieHeader(
  name: string,
  value: string,
  opts: ReturnType<typeof nexusDashboardCookieOptions>,
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${opts.path}`,
    `Max-Age=${opts.maxAge}`,
    `SameSite=${opts.sameSite === 'lax' ? 'Lax' : opts.sameSite}`,
  ];
  if (opts.httpOnly) parts.push('HttpOnly');
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

export function buildClearCookieHeader(name: string): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;
}
