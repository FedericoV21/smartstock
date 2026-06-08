import { NextResponse } from 'next/server';

import {
  getNexusDashboardPassword,
  NEXUS_DASHBOARD_COOKIE,
  nexusDashboardCookieOptions,
  signNexusDashboardSession,
} from '@/lib/nexus-dashboard/auth-cookie';

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido.' }, { status: 400 });
  }
  const password =
    typeof body === 'object' && body !== null && 'password' in body
      ? String((body as { password: unknown }).password)
      : '';

  if (password !== getNexusDashboardPassword()) {
    return NextResponse.json({ error: 'Contraseña incorrecta.' }, { status: 401 });
  }

  const token = signNexusDashboardSession();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(NEXUS_DASHBOARD_COOKIE, token, nexusDashboardCookieOptions());
  return res;
}
