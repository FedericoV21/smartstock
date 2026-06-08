'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export type ConfirmOptions = {
  title: string;
  /** Texto principal; podés usar varios párrafos como hijos. */
  description?: ReactNode;
  confirmLabel?: string;
  /** Si es `null`, solo se muestra el botón principal (tipo aviso). */
  cancelLabel?: string | null;
  confirmVariant?: 'default' | 'destructive';
  contentClassName?: string;
};

/**
 * Diálogo de confirmación alineado al diseño del sistema (sin `window.confirm`).
 * Devuelve `ConfirmDialog` para renderizarlo una vez en el árbol del componente.
 */
export function useConfirm() {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const settle = useCallback((value: boolean) => {
    const r = resolveRef.current;
    resolveRef.current = null;
    setOpen(false);
    setOptions(null);
    r?.(value);
  }, []);

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setOptions(opts);
      setOpen(true);
    });
  }, []);

  /** Un solo botón “Entendido”; ESC / clic fuera equivalen a cerrar el aviso. */
  const alert = useCallback(
    async (opts: Pick<ConfirmOptions, 'title' | 'description' | 'contentClassName'> & { buttonLabel?: string }) => {
      await confirm({
        title: opts.title,
        description: opts.description,
        confirmLabel: opts.buttonLabel ?? 'Entendido',
        cancelLabel: null,
        contentClassName: opts.contentClassName,
      });
    },
    [confirm],
  );

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && resolveRef.current) {
        settle(options?.cancelLabel === null ? true : false);
      }
    },
    [options?.cancelLabel, settle],
  );

  const ConfirmDialog =
    options != null ? (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          showCloseButton={options.cancelLabel !== null}
          className={cn('sm:max-w-md', options.contentClassName)}
        >
          <DialogHeader>
            <DialogTitle>{options.title}</DialogTitle>
            {options.description != null ? (
              <DialogDescription>{options.description}</DialogDescription>
            ) : null}
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0" showCloseButton={false}>
            {options.cancelLabel !== null ? (
              <Button type="button" variant="outline" onClick={() => settle(false)}>
                {options.cancelLabel ?? 'Cancelar'}
              </Button>
            ) : null}
            <Button
              type="button"
              variant={options.confirmVariant ?? 'default'}
              onClick={() => settle(true)}
            >
              {options.confirmLabel ?? 'Confirmar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    ) : null;

  return { confirm, alert, ConfirmDialog };
}
