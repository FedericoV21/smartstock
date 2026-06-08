'use client';

import { FileDown } from 'lucide-react';
import { useState } from 'react';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Props = {
  onGenerar: () => void | Promise<void>;
  disabled?: boolean;
  className?: string;
};

export function BotonDescargarPdf({ onGenerar, disabled, className }: Props) {
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={disabled || busy}
      className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'inline-flex', className)}
      onClick={async () => {
        setBusy(true);
        try {
          await onGenerar();
        } finally {
          setBusy(false);
        }
      }}
    >
      <FileDown className="mr-1.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      {busy ? 'Generando PDF…' : 'Descargar PDF'}
    </button>
  );
}
