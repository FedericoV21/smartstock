import { NextRequest, NextResponse } from 'next/server';

import { defaultNextAfterEmailLink } from '@/lib/auth/auth-completion-paths';
import { safeNextPath } from '@/lib/auth/safe-redirect';

/**
 * Alias habitual en plantillas de Supabase (`{{ .SiteURL }}/auth/confirm?...`).
 * Reenvía al callback de la app con el `next` adecuado.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const callback = new URL('/api/auth/callback', url.origin);

  url.searchParams.forEach((value, key) => {
    callback.searchParams.set(key, value);
  });

  if (!callback.searchParams.has('next')) {
    const type = callback.searchParams.get('type');
    callback.searchParams.set('next', defaultNextAfterEmailLink(type));
  } else {
    const next = safeNextPath(callback.searchParams.get('next'), '/');
    callback.searchParams.set('next', next);
  }

  return NextResponse.redirect(callback, { status: 303 });
}
