import { NextResponse } from 'next/server';

import { buildAuthCallbackUrl } from '@/lib/auth/auth-callback-url';
import { EMAIL_RE } from '@/lib/auth/validar-registro';
import { apiErrorPayload } from '@/lib/errors/user-copy';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/lib/supabase/env-keys';

/**
 * Reenvío de OTP de registro vía GoTrue (mismo endpoint que el cliente).
 * Centraliza el redirect y permite diagnosticar fallos sin exponer detalles técnicos.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo de la solicitud inválido.' }, { status: 400 });
  }

  const raw = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  const email = String(raw?.email ?? '')
    .trim()
    .toLowerCase();

  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Ingresá un correo electrónico válido.' }, { status: 400 });
  }

  const supabaseUrl = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  if (!supabaseUrl || !anonKey) {
    return NextResponse.json(
      apiErrorPayload('auth', 'config', 'El servicio de registro no está configurado.'),
      { status: 503 },
    );
  }

  const emailRedirectTo = buildAuthCallbackUrl('/register');

  try {
    const res = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/resend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify({
        type: 'signup',
        email,
        options: { emailRedirectTo },
      }),
    });

    const payload = (await res.json().catch(() => ({}))) as {
      error?: string;
      error_description?: string;
      msg?: string;
    };

    if (!res.ok) {
      const rawError = payload.error_description ?? payload.msg ?? payload.error ?? '';
      return NextResponse.json(
        apiErrorPayload(
          'auth',
          rawError,
          'No pudimos reenviar el código de verificación. Reintentá en unos minutos.',
        ),
        { status: res.status >= 400 && res.status < 600 ? res.status : 400 },
      );
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      apiErrorPayload(
        'auth',
        'network',
        'No pudimos reenviar el código por un problema de conexión. Reintentá en unos minutos.',
      ),
      { status: 502 },
    );
  }
}
