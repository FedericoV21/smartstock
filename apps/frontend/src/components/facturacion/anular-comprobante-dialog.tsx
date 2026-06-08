'use client';

import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { MOTIVO_ANULACION_MIN_LEN } from '@/lib/facturacion/anular-comprobante-sin-cae';
import { cn } from '@/lib/utils';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  comprobanteId: string | null;
  /** Base sin trailing slash, ej. `/api/facturacion` */
  apiBasePath?: string;
  onAnulado?: () => void;
};

export function AnularComprobanteDialog({
  open,
  onOpenChange,
  comprobanteId,
  apiBasePath = '/api/facturacion',
  onAnulado,
}: Props) {
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reset = useCallback(() => {
    setMotivo('');
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!open) {
      reset();
    }
  }, [open, reset]);

  async function confirmar() {
    if (!comprobanteId?.trim()) return;
    const m = motivo.trim();
    if (m.length < MOTIVO_ANULACION_MIN_LEN) {
      setError(`El motivo debe tener al menos ${MOTIVO_ANULACION_MIN_LEN} caracteres.`);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBasePath}/${comprobanteId}/anular-sin-cae`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ motivo: m }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(typeof json.error === 'string' ? json.error : 'No se pudo anular');
        return;
      }
      onOpenChange(false);
      reset();
      onAnulado?.();
    } catch {
      setError('Error de red');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Anular comprobante (reverso interno)</DialogTitle>
          <DialogDescription className="space-y-2 text-left">
            <span className="block">
              Se revierte stock y deuda de cuenta corriente según corresponda. Los cobros en efectivo o por
              terminal debés gestionarlos manualmente en caja.
            </span>
            <span className="block text-destructive">Esta acción no se puede deshacer.</span>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label htmlFor="motivo-anulacion" className="text-sm font-medium text-foreground">
            Motivo de anulación <span className="text-destructive">*</span>
          </label>
          <textarea
            id="motivo-anulacion"
            rows={4}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ej.: cliente devolvió la mercadería, error en el armado del pedido…"
            className={cn(
              'w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none',
              'placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
              'disabled:opacity-50 md:text-sm dark:bg-input/30',
            )}
            disabled={loading}
          />
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button type="button" variant="destructive" onClick={() => void confirmar()} disabled={loading}>
            {loading ? 'Anulando…' : 'Anular'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
