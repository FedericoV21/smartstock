import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { NEXUS_DASHBOARD_COOKIE, verifyNexusDashboardSession } from '@/lib/nexus-dashboard/auth-cookie';

export async function GET() {
  const jar = await cookies();
  const ok = verifyNexusDashboardSession(jar.get(NEXUS_DASHBOARD_COOKIE)?.value);
  return NextResponse.json({ ok });
}
