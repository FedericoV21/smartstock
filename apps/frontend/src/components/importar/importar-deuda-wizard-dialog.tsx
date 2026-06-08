'use client';

import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  proveedorTieneCondicionPagoCargada,
  type ProveedorCondicionPago,
} from '@/lib/cuenta-corriente/pago-proveedor-vencimiento';

export type ImportDeudaWizardResult =
  | { tipo: 'contado' }
  | {
      tipo: 'deuda';
      modoVenc: 'condicion' | 'fecha_fija';
      fechaOperacionYmd: string;
      vencimientoYmd?: string;
    };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proveedorId: string;
  archivoNombre: string;
  origenPrecio: 'importacion_excel' | 'ia_pdf';
  onConfirm: (r: ImportDeudaWizardResult) => void;
};

function hoyYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ImportarDeudaWizardDialog({
  open,
  onOpenChange,
  proveedorId,
  archivoNombre,
  origenPrecio,
  onConfirm,
}: Props) {
  const [paso, setPaso] = useState<1 | 2>(1);
  const [eleccion, setEleccion] = useState<'contado' | 'deuda' | null>(null);
  const [modoVenc, setModoVenc] = useState<'condicion' | 'fecha_fija'>('condicion');
  const [fechaOperacion, setFechaOperacion] = useState(hoyYmd);
  const [vencimientoYmd, setVencimientoYmd] = useState(hoyYmd);
  const [provCond, setProvCond] = useState<ProveedorCondicionPago | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const reset = useCallback(() => {
    setPaso(1);
    setEleccion(null);
    setModoVenc('condicion');
    const h = hoyYmd();
    setFechaOperacion(h);
    setVencimientoYmd(h);
    setProvCond(null);
    setErr(null);
  }, []);

  useEffect(() => {
    if (!open) {
      reset();
      return;
    }
    reset();
  }, [open, reset]);

  useEffect(() => {
    if (!open || paso !== 2 || eleccion !== 'deuda') return;
    void (async () => {
      try {
        const res = await fetch(`/api/proveedores/${proveedorId}`);
        if (!res.ok) return;
        const j = (await res.json()) as {
          condicion_pago_default?: 'contado' | 'dias';
          plazo_pago_dias?: number | null;
        };
        setProvCond({
          condicion_pago_default: j.condicion_pago_default ?? 'contado',
          plazo_pago_dias: j.plazo_pago_dias ?? null,
        });
      } catch {
        setProvCond(null);
      }
    })();
  }, [open, paso, eleccion, proveedorId]);

  function handleSiguiente() {
    setErr(null);
    if (paso === 1) {
      if (eleccion === 'contado') {
        onConfirm({ tipo: 'contado' });
        onOpenChange(false);
        return;
      }
      if (eleccion === 'deuda') {
        setPaso(2);
        return;
      }
      setErr('Elegí una opción');
    }
  }

  function handleConfirmarDeuda() {
    setErr(null);
    if (modoVenc === 'condicion') {
      if (!proveedorTieneCondicionPagoCargada(provCond)) {
        setErr(
          'Este proveedor no tiene plazo o condición cargada. Usá “Fecha de vencimiento” o completá la ficha del proveedor.',
        );
        return;
      }
    } else {
      if (!vencimientoYmd || vencimientoYmd.length < 10) {
        setErr('Indicá la fecha de vencimiento');
        return;
      }
      if (vencimientoYmd < fechaOperacion) {
        setErr('El vencimiento no puede ser anterior a la fecha de la operación');
        return;
      }
    }
    onConfirm({
      tipo: 'deuda',
      modoVenc,
      fechaOperacionYmd: fechaOperacion.slice(0, 10),
      vencimientoYmd: modoVenc === 'fecha_fija' ? vencimientoYmd.slice(0, 10) : undefined,
    });
    onOpenChange(false);
  }

  const tituloOrigen = origenPrecio === 'ia_pdf' ? 'lista (IA)' : 'lista (Excel/CSV)';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {paso === 1 ? 'Cómo registrar la compra' : 'Vencimiento del pago'}
          </DialogTitle>
        </DialogHeader>

        {paso === 1 ? (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Archivo: <span className="text-foreground">{archivoNombre}</span> · importación de{' '}
              {tituloOrigen}.
            </p>
            <fieldset className="space-y-2">
              <legend className="sr-only">Forma de registro</legend>
              <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-muted/40">
                <input
                  type="radio"
                  name="imp-deuda-1"
                  className="mt-0.5"
                  checked={eleccion === 'contado'}
                  onChange={() => setEleccion('contado')}
                />
                <span>
                  <span className="font-medium">A contado</span>
                  <span className="text-muted-foreground block text-xs">
                    Solo actualiza productos y stock. No suma deuda al proveedor.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-muted/40">
                <input
                  type="radio"
                  name="imp-deuda-1"
                  className="mt-0.5"
                  checked={eleccion === 'deuda'}
                  onChange={() => setEleccion('deuda')}
                />
                <span>
                  <span className="font-medium">A deuda (crédito del proveedor)</span>
                  <span className="text-muted-foreground block text-xs">
                    Suma el importe aproximado (stock × costo) en cuenta corriente y podés definir el
                    vencimiento en el siguiente paso.
                  </span>
                </span>
              </label>
            </fieldset>
            {err ? <p className="text-destructive text-xs">{err}</p> : null}
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            <div className="grid gap-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="fec-op">
                Fecha de la operación (para calcular el vencimiento)
              </label>
              <input
                id="fec-op"
                type="date"
                className="border-input h-9 rounded-md border bg-background px-2 text-sm"
                value={fechaOperacion}
                onChange={(e) => setFechaOperacion(e.target.value)}
              />
            </div>

            <fieldset className="space-y-2">
              <legend className="text-xs font-medium text-muted-foreground">Vencimiento del pago</legend>
              <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-muted/40">
                <input
                  type="radio"
                  name="imp-venc"
                  className="mt-0.5"
                  checked={modoVenc === 'condicion'}
                  onChange={() => setModoVenc('condicion')}
                />
                <span>
                  <span className="font-medium">Según condición del proveedor</span>
                  <span className="text-muted-foreground block text-xs">
                    {provCond == null
                      ? 'Cargando…'
                      : provCond.condicion_pago_default === 'contado'
                        ? 'Contado: vence el mismo día que la operación.'
                        : provCond.plazo_pago_dias != null && provCond.plazo_pago_dias > 0
                          ? `A ${provCond.plazo_pago_dias} días desde la operación.`
                          : 'Sin plazo cargado en la ficha — usá fecha fija o editá el proveedor.'}
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-muted/40">
                <input
                  type="radio"
                  name="imp-venc"
                  className="mt-0.5"
                  checked={modoVenc === 'fecha_fija'}
                  onChange={() => setModoVenc('fecha_fija')}
                />
                <span>
                  <span className="font-medium">Fecha de vencimiento fija</span>
                  <span className="text-muted-foreground block text-xs">
                    Elegí el día en que vence el pago.
                  </span>
                </span>
              </label>
            </fieldset>

            {modoVenc === 'fecha_fija' ? (
              <div className="grid gap-1.5">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="fec-ven">
                  Vencimiento
                </label>
                <input
                  id="fec-ven"
                  type="date"
                  className="border-input h-9 rounded-md border bg-background px-2 text-sm"
                  value={vencimientoYmd}
                  min={fechaOperacion}
                  onChange={(e) => setVencimientoYmd(e.target.value)}
                />
              </div>
            ) : null}

            {err ? <p className="text-destructive text-xs">{err}</p> : null}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {paso === 2 ? (
            <Button type="button" variant="outline" onClick={() => setPaso(1)}>
              Atrás
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
          )}
          {paso === 1 ? (
            <Button type="button" onClick={handleSiguiente}>
              {eleccion === 'contado' ? 'Importar' : 'Siguiente'}
            </Button>
          ) : (
            <Button type="button" onClick={handleConfirmarDeuda}>
              Importar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
