'use client';

import { useCallback, useEffect, useState } from 'react';
import { LockOpen } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MontoInput } from '@/components/ui/monto-input';
import { formatCurrency } from '@/lib/utils/formatters';

export function PosAbrirCajaModal({
  open,
  onOpenChange,
  fechaOperativa = null,
  cajaId = null,
  cajaEtiqueta = null,
  onAperturaRegistrada,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Si no se envía, el servidor usa el día calendario en Argentina. */
  fechaOperativa?: string | null;
  cajaId?: string | null;
  cajaEtiqueta?: string | null;
  onAperturaRegistrada?: () => void | Promise<void>;
}) {
  const [fondo, setFondo] = useState<number | null>(null);
  const [ultimoCierre, setUltimoCierre] = useState<number | null>(null);
  const [loadingHint, setLoadingHint] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargarReferencia = useCallback(async () => {
    setLoadingHint(true);
    setError(null);
    const qs = new URLSearchParams();
    if (cajaId?.trim()) qs.set('caja_id', cajaId.trim());
    const res = await fetch(`/api/caja/apertura?${qs.toString()}`, { cache: 'no-store' });
    const json = (await res.json()) as { ultimo_cierre_contado?: number | null; error?: string };
    if (res.ok) {
      setUltimoCierre(
        json.ultimo_cierre_contado !== undefined && json.ultimo_cierre_contado !== null
          ? Number(json.ultimo_cierre_contado)
          : null,
      );
    } else {
      setUltimoCierre(null);
    }
    setLoadingHint(false);
  }, [cajaId]);

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      setFondo(null);
      setError(null);
      void cargarReferencia();
    });
  }, [open, cargarReferencia]);

  async function confirmar() {
    if (fondo === null) {
      setError('Ingresá cuánto efectivo hay en la gaveta al abrir (puede ser 0).');
      return;
    }
    setSaving(true);
    setError(null);
    const payload: Record<string, unknown> = {
      caja_id: cajaId?.trim() || null,
      fondo_efectivo: fondo,
    };
    if (fechaOperativa?.trim()) payload.fecha_operativa = fechaOperativa.trim();
    console.info('[pos-caja-debug] apertura:confirmar:inicio', {
      caja_id: payload.caja_id,
      fecha_operativa: payload.fecha_operativa ?? null,
      fondo_efectivo: payload.fondo_efectivo,
    });
    let res: Response;
    let json: {
      error?: string;
      apertura?: { id: string; opened_at: string; fondo_efectivo: number; fecha_operativa: string };
    };
    try {
      res = await fetch('/api/caja/apertura', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      json = (await res.json()) as typeof json;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error desconocido';
      console.error('[pos-caja-debug] apertura:confirmar:fetch_error', { message: msg });
      setError(`No se pudo contactar al servidor: ${msg}`);
      setSaving(false);
      return;
    }
    console.info('[pos-caja-debug] apertura:confirmar:respuesta', {
      ok: res.ok,
      status: res.status,
      error: json.error ?? null,
      apertura_id: json.apertura?.id ?? null,
    });
    if (!res.ok) {
      setError(json.error ?? 'No se pudo registrar la apertura');
      setSaving(false);
      return;
    }
    if (!json.apertura?.id) {
      console.error('[pos-caja-debug] apertura:confirmar:sin_apertura', { status: res.status, json });
      setError('La apertura no devolvió datos. Reintentá o recargá la página.');
      setSaving(false);
      return;
    }
    console.info('[pos-caja-debug] apertura:confirmar:ok', {
      apertura_id: json.apertura.id,
      opened_at: json.apertura.opened_at,
      fecha_operativa: json.apertura.fecha_operativa,
    });
    setSaving(false);
    onOpenChange(false);
    await onAperturaRegistrada?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="z-[200] w-[calc(100%-1.5rem)] sm:max-w-md"
        showCloseButton
        aria-describedby="pos-abrir-caja-desc"
      >
        <DialogHeader>
          <div className="flex items-center gap-2 text-[color:var(--brand-primary)]">
            <LockOpen className="h-6 w-6 shrink-0" aria-hidden />
            <DialogTitle>Abrir caja</DialogTitle>
          </div>
          <DialogDescription id="pos-abrir-caja-desc">
            Declarás el efectivo inicial de la sesión. Hasta no abrir, no podés cobrar ventas en el POS (así el
            cierre cuadra con el fondo real del día). Al confirmar, también se abre tu turno en la caja elegida.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            La apertura queda registrada con fecha y hora automáticas.
            {cajaEtiqueta?.trim() ? (
              <>
                {' '}
                · Caja <span className="font-medium text-foreground">{cajaEtiqueta.trim()}</span>
              </>
            ) : cajaId?.trim() ? (
              <>
                {' '}
                · Caja <span className="font-medium text-foreground">{cajaId.trim()}</span>
              </>
            ) : (
              <span> · Sin ID de caja (misma lógica que tickets sin caja).</span>
            )}
          </p>

          {loadingHint ? (
            <p className="text-sm text-muted-foreground">Cargando referencia…</p>
          ) : ultimoCierre !== null ? (
            <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              Último cierre registró{' '}
              <span className="font-semibold tabular-nums text-foreground">{formatCurrency(ultimoCierre)}</span> en
              efectivo contado. Si el dueño dejó otro monto para vuelto, ingresá el que corresponde hoy.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Es el primer cierre o no hay arqueo previo guardado.</p>
          )}

          <label className="grid gap-2 text-sm">
            <span className="font-medium text-foreground">Efectivo en gaveta al abrir</span>
            <MontoInput
              placeholder="0,00"
              value={fondo}
              onValueChange={setFondo}
              min={0}
              decimals={2}
              className="text-lg"
              autoFocus
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'pos-abrir-caja-err' : undefined}
            />
          </label>

          {error ? (
            <p id="pos-abrir-caja-err" className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="ghost" className="cursor-pointer" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              className="cursor-pointer min-h-11 px-6"
              disabled={saving || fondo === null}
              onClick={() => void confirmar()}
            >
              {saving ? 'Guardando…' : 'Confirmar apertura'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
