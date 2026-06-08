'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const DISMISS_KEY = 'nexus_dismiss_arca_resolver_banner';

export function ArcaResolverBanner() {
  const [count, setCount] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof globalThis.sessionStorage === 'undefined') return;
    setDismissed(sessionStorage.getItem(DISMISS_KEY) === '1');
  }, []);

  useEffect(() => {
    if (dismissed) return;
    void (async () => {
      try {
        const res = await fetch('/api/facturacion/bandeja-arca/alerta', { cache: 'no-store' });
        const json = (await res.json()) as { count?: number; disabled?: boolean };
        if (res.ok && !json.disabled) {
          setCount(typeof json.count === 'number' ? json.count : 0);
        } else {
          setCount(0);
        }
      } catch {
        setCount(0);
      }
    })();
  }, [dismissed]);

  if (dismissed || count === null || count < 1) {
    return null;
  }

  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-lg border border-semantic-arca-error-fg/30 bg-semantic-arca-error-bg px-4 py-3 text-sm text-semantic-arca-error-fg sm:flex-row sm:items-center sm:justify-between"
    >
      <p>
        Tenés <strong>{count}</strong> factura{count === 1 ? '' : 's'} con error de autorización en ARCA/AFIP.
      </p>
      <div className="flex flex-wrap gap-2">
        <Link
          href="/facturacion/resolver-arca"
          className={cn(buttonVariants({ size: 'sm' }), 'bg-primary text-primary-foreground hover:bg-primary/90')}
        >
          Ir al centro de errores
        </Link>
        <button
          type="button"
          className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
          onClick={() => {
            sessionStorage.setItem(DISMISS_KEY, '1');
            setDismissed(true);
          }}
        >
          Cerrar
        </button>
      </div>
    </div>
  );
}
