import { NextResponse } from 'next/server';

import { NEXUS_DASHBOARD_COOKIE } from '@/lib/nexus-dashboard/auth-cookie';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(NEXUS_DASHBOARD_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
  return res;
}
