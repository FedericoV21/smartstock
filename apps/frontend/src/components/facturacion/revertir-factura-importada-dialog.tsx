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

export type ReversionFacturaImportadaResumen = {
  stock_movimientos_revertidos: number;
  cuenta_corriente_revertida: number;
  cuenta_corriente_ajuste_neto: number;
  obligaciones_proveedor_anuladas: number;
  pagos_proveedor_compensados: number;
  pagos_proveedor_total_compensado: number;
  productos_restaurados: number;
  productos_desactivados: number;
  productos_omitidos: number;
  precios_sucursal_restaurados: number;
  precios_sucursal_omitidos: number;
  lotes_ajustados: number;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  comprobanteId: string | null;
  apiBasePath?: string;
  onRevertida?: (resumen: ReversionFacturaImportadaResumen) => void;
};

export function RevertirFacturaImportadaDialog({
  open,
  onOpenChange,
  comprobanteId,
  apiBasePath = '/api/facturacion',
  onRevertida,
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
      const res = await fetch(`${apiBasePath}/${comprobanteId}/revertir-importada`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ motivo: m }),
      });
      const json = (await res.json()) as {
        error?: string;
        resumen?: ReversionFacturaImportadaResumen;
      };
      if (!res.ok) {
        setError(typeof json.error === 'string' ? json.error : 'No se pudo revertir');
        return;
      }
      onOpenChange(false);
      reset();
      if (json.resumen) {
        onRevertida?.(json.resumen);
      }
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
          <DialogTitle>Revertir factura importada</DialogTitle>
          <DialogDescription className="space-y-2 text-left">
            <span className="block">
              Se devuelve el stock, se descuenta la deuda del proveedor y se restauran cambios de
              catalogo solo si el producto no fue editado despues.
            </span>
            <span className="block">
              Si ya tenia pagos simples, se compensan contra la cuenta corriente. Si tienen recibo,
              primero hay que anular ese recibo.
            </span>
            <span className="block text-destructive">Esta accion no se puede deshacer.</span>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label htmlFor="motivo-reversion-importada" className="text-sm font-medium text-foreground">
            Motivo de reversion <span className="text-destructive">*</span>
          </label>
          <textarea
            id="motivo-reversion-importada"
            rows={4}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ej.: factura cargada por error, proveedor incorrecto, lectura IA incorrecta..."
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
            {loading ? 'Revirtiendo...' : 'Revertir'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
