'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { clearAllPosCartsFromLocalStorage } from '@/lib/pos/cart-persistence';
import { createBrowserClient } from '@/lib/supabase/client';

export default function CuentaSinPerfilPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleSignOut() {
    setLoading(true);
    clearAllPosCartsFromLocalStorage();
    const supabase = createBrowserClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <div className="rounded-lg border bg-white p-8 shadow-sm">
      <h1 className="text-xl font-semibold tracking-tight">Cuenta sin perfil</h1>
      <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
        Tu sesión es válida, pero no hay un perfil de aplicación vinculado a tu usuario (tabla{' '}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">public.usuario</code>). Suele pasar si el
        usuario se creó en Auth sin completar el registro en la app, o si faltó insertar el perfil en la
        base.
      </p>
      <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
        Quien administra el proyecto puede corregirlo en Supabase: verificar que exista una fila en{' '}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">usuario</code> con el mismo{' '}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">id</code> que en{' '}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">auth.users</code>, o volvé a registrarte
        con el flujo de alta de negocio.
      </p>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        <Button type="button" variant="default" disabled={loading} onClick={handleSignOut}>
          Cerrar sesión
        </Button>
      </div>
    </div>
  );
}
