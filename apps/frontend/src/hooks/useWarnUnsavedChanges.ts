'use client';

import { useEffect } from 'react';

import { usePathname, useRouter } from 'next/navigation';

export const UNSAVED_LEAVE_TITLE = 'Cambios sin guardar';

export const UNSAVED_LEAVE_DESCRIPTION =
  'Hay cambios sin guardar en esta página. Si salís sin guardar, se pierden. ¿Seguimos de todos modos?';

/** Mensaje legacy (unload del navegador); el navegador puede mostrar texto genérico. */
export const UNSAVED_LEAVE_MESSAGE = `${UNSAVED_LEAVE_TITLE}\n${UNSAVED_LEAVE_DESCRIPTION}`;

export type WarnUnsavedChangesOpts = {
  /** Obligatorio para interceptar navegación interna (SPA) sin `window.confirm`. */
  confirmLeave?: () => Promise<boolean>;
};

/** Aviso al cerrar pestaña/recargar y al seguir enlaces internos con cambios pendientes (SPA). */
export function useWarnUnsavedChanges(
  hasUnsavedChanges: boolean,
  opts?: WarnUnsavedChangesOpts,
): void {
  const pathname = usePathname();
  const router = useRouter();
  const confirmLeave = opts?.confirmLeave;

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!hasUnsavedChanges || !confirmLeave) return;

    const onAnchorClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!el?.href || el.download || el.target === '_blank') return;

      const rawHref = el.getAttribute('href');
      if (!rawHref || rawHref.startsWith('#')) return;

      let url: URL;
      try {
        url = new URL(el.href, window.location.origin);
      } catch {
        return;
      }

      if (url.origin !== window.location.origin) return;

      const sameDestination =
        url.pathname.replace(/\/$/, '') === pathname.replace(/\/$/, '') &&
        url.search === window.location.search;
      if (sameDestination) return;

      e.preventDefault();
      e.stopPropagation();

      const target = `${url.pathname}${url.search}${url.hash}`;
      void (async () => {
        const ok = await confirmLeave();
        if (!ok) return;
        router.push(target);
      })();
    };

    document.addEventListener('click', onAnchorClick, true);
    return () => document.removeEventListener('click', onAnchorClick, true);
  }, [confirmLeave, hasUnsavedChanges, pathname, router]);
}
