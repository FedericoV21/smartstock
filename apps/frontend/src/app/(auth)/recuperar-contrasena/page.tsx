'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { buildAuthEmailLandingUrl } from '@/lib/auth/auth-callback-url';
import { markPendingPasswordReset } from '@/lib/auth/pending-password-reset';
import { createBrowserClient } from '@/lib/supabase/client';

function RecuperarContrasenaForm() {
  const searchParams = useSearchParams();
  const linkError =
    searchParams.get('error') === 'auth_callback_failed'
      ? 'El enlace no es válido o ya venció. Pedí uno nuevo abajo.'
      : null;

  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      setError('Ingresá tu correo.');
      setLoading(false);
      return;
    }

    try {
      const supabase = createBrowserClient();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(trimmed, {
        redirectTo: buildAuthEmailLandingUrl('/recuperar-contrasena/nueva'),
      });
      if (resetError) {
        setError(resetError.message);
        return;
      }
      markPendingPasswordReset();
      setMessage(
        'Si ese correo está registrado, te enviamos un enlace para restablecer la contraseña. Revisá la bandeja y el correo no deseado.',
      );
    } catch {
      setError('Error de conexión. Intentá de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border bg-white p-8 shadow-sm">
      <h1 className="text-2xl font-bold">Restablecer contraseña</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Te enviaremos un enlace para elegir una contraseña nueva. El enlace pasa por nuestro servidor
        para guardar la sesión de forma segura.
      </p>

      {linkError ? (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {linkError}
        </p>
      ) : null}

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-sm font-medium">
            Correo electrónico
          </label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={loading}
          />
        </div>

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="text-sm text-muted-foreground" role="status">
            {message}
          </p>
        ) : null}

        <Button type="submit" disabled={loading} className="w-full">
          {loading ? 'Enviando…' : 'Enviar enlace'}
        </Button>
      </form>

      <p className="mt-4 text-center text-sm text-muted-foreground">
        <Link href="/login" className="text-primary underline-offset-4 hover:underline">
          Volver a iniciar sesión
        </Link>
      </p>
    </div>
  );
}

export default function RecuperarContrasenaPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-lg border bg-white p-8 text-sm text-muted-foreground shadow-sm">
          Cargando…
        </div>
      }
    >
      <RecuperarContrasenaForm />
    </Suspense>
  );
}
