import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { resolveTenantBusinessSetupForUser } from '@/lib/dashboard/tenant-setup';
import type { Database } from '@/types/database';

const publicRoutes = [
  '/login',
  '/register',
  '/api/auth/callback',
  '/api/auth/register',
];

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const path = request.nextUrl.pathname;
  const logApiSession = (phase: string, extra?: Record<string, unknown>) => {
    if (!path.startsWith('/api/proveedores') && !path.startsWith('/api/productos')) return;
    const all = request.cookies.getAll();
    const sb = all.filter(
      (c) => c.name.startsWith('sb-') || c.name.toLowerCase().includes('auth')
    );
    // #region agent log
    fetch('http://127.0.0.1:7729/ingest/b7d77d9b-b0af-4230-81eb-50c688422230', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'c9181b' },
      body: JSON.stringify({
        sessionId: 'c9181b',
        runId: 'post-fix',
        hypothesisId: 'H1-H3',
        location: 'middleware.ts:getUser',
        message: phase,
        data: {
          path,
          cookieCount: all.length,
          sbNames: sb.map((c) => c.name),
          sbValueLengths: sb.map((c) => c.value.length),
          emptySbCookieNames: sb.filter((c) => c.value.length === 0).map((c) => c.name),
          ...extra,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  };

  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>['data']['user'];
  logApiSession('before auth.getUser');
  try {
    const {
      data: { user: u },
    } = await supabase.auth.getUser();
    user = u;
    logApiSession('after auth.getUser ok', { hasUser: !!user });
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logApiSession('after auth.getUser error', {
      errName: err.name,
      errMessage: err.message,
    });
    throw e;
  }

  const isPublicRoute = publicRoutes.some((route) =>
    request.nextUrl.pathname.startsWith(route)
  );

  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  if (user && !isPublicRoute && !path.startsWith('/api')) {
    const setup = await resolveTenantBusinessSetupForUser(supabase, user.id);
    if (setup === null) {
      if (!path.startsWith('/cuenta-sin-perfil')) {
        const url = request.nextUrl.clone();
        url.pathname = '/cuenta-sin-perfil';
        return NextResponse.redirect(url);
      }
    } else if (
      !setup.complete &&
      setup.rol === 'admin' &&
      !path.startsWith('/onboarding')
    ) {
      const url = request.nextUrl.clone();
      url.pathname = '/onboarding';
      return NextResponse.redirect(url);
    }
  }

  if (user && isPublicRoute && !request.nextUrl.pathname.startsWith('/api')) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
