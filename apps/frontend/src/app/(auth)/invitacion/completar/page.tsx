'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { PasswordInput } from '@/components/ui/password-input';
import {
  bootstrapEmailLinkSession,
  waitForAuthUser,
} from '@/lib/auth/bootstrap-email-link-session';
import { createBrowserClient } from '@/lib/supabase/client';

export default function CompletarInvitacionPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createBrowserClient();
      await bootstrapEmailLinkSession(supabase);
      const hasUser = await waitForAuthUser(supabase);
      if (cancelled) return;
      if (!hasUser) {
        router.replace('/login?error=auth_callback_failed');
        return;
      }
      setChecking(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.');
      return;
    }
    if (password !== password2) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    setLoading(true);
    try {
      const supabase = createBrowserClient();
      const { error: updErr } = await supabase.auth.updateUser({ password });
      if (updErr) {
        setError(updErr.message);
        return;
      }
      router.push('/');
      router.refresh();
    } catch {
      setError('Error de conexión. Intentá de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div className="rounded-lg border bg-white p-8 shadow-sm text-sm text-muted-foreground">
        Cargando…
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-white p-8 shadow-sm">
      <h1 className="text-2xl font-bold">Completá tu registro</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Elegí una contraseña para acceder a tu cuenta.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-sm font-medium">
            Contraseña
          </label>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            disabled={loading}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="password2" className="text-sm font-medium">
            Repetir contraseña
          </label>
          <PasswordInput
            id="password2"
            name="password2"
            autoComplete="new-password"
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
            required
            minLength={6}
            disabled={loading}
          />
        </div>

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={loading} className="w-full">
          {loading ? 'Guardando…' : 'Guardar contraseña'}
        </Button>
      </form>
    </div>
  );
}
