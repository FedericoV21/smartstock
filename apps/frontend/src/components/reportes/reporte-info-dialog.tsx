'use client';

import { Info } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

type ReporteInfoDialogProps = {
  title: string;
  children: ReactNode;
  buttonLabel?: string;
  className?: string;
};

export function ReporteInfoDialog({
  title,
  children,
  buttonLabel = 'Más info',
  className,
}: ReporteInfoDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn('inline-flex gap-1.5', className)}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
        {buttonLabel}
      </Button>
      <DialogContent showCloseButton className="max-h-[min(85vh,36rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
