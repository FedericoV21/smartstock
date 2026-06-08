'use client';

import { Loader2, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { MontoInput } from '@/components/ui/monto-input';
import type { CajaGastoSesionRow } from '@/lib/caja/caja-gastos-sesion';
import { formatCurrency } from '@/lib/utils/formatters';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cajaId?: string | null;
  cajaEtiqueta?: string | null;
  onGastosActualizados?: (total: number) => void;
};

export function PosGastosEfectivoModal({
  open,
  onOpenChange,
  cajaId = null,
  cajaEtiqueta = null,
  onGastosActualizados,
}: Props) {
  const [items, setItems] = useState<CajaGastoSesionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [concepto, setConcepto] = useState('');
  const [monto, setMonto] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [anulandoId, setAnulandoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cajaTexto = cajaEtiqueta?.trim() || cajaId?.trim() || 'Caja actual';

  const cargarGastos = useCallback(async () => {
    const cid = cajaId?.trim();
    if (!cid) {
      setItems([]);
      setTotal(0);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ caja_id: cid });
      const res = await fetch(`/api/caja/gastos?${qs.toString()}`, { cache: 'no-store' });
      const json = (await res.json()) as {
        items?: CajaGastoSesionRow[];
        total?: number;
        error?: string;
      };
      if (!res.ok) {
        setItems([]);
        setTotal(0);
        setError(json.error ?? 'No se pudieron cargar los gastos');
        return;
      }
      const nextItems = json.items ?? [];
      const nextTotal = Number(json.total ?? 0);
      setItems(nextItems);
      setTotal(nextTotal);
      onGastosActualizados?.(nextTotal);
    } catch {
      setError('Error de red al cargar gastos');
    } finally {
      setLoading(false);
    }
  }, [cajaId, onGastosActualizados]);

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      setConcepto('');
      setMonto(null);
      setError(null);
      void cargarGastos();
    });
  }, [open, cargarGastos]);

  async function registrar() {
    const cid = cajaId?.trim();
    const c = concepto.trim();
    const m = monto;
    if (!cid) {
      setError('No hay caja activa para registrar gastos.');
      return;
    }
    if (!c) {
      setError('Indicá de qué es el gasto.');
      return;
    }
    if (m == null || !Number.isFinite(m) || m <= 0) {
      setError('Ingresá un monto mayor a 0.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/caja/gastos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caja_id: cid, concepto: c, monto: m }),
      });
      const json = (await res.json()) as { total?: number; error?: string };
      if (!res.ok) {
        setError(json.error ?? 'No se pudo registrar el gasto');
        setSaving(false);
        return;
      }
      setConcepto('');
      setMonto(null);
      setSaving(false);
      await cargarGastos();
      if (json.total != null) {
        setTotal(json.total);
        onGastosActualizados?.(json.total);
      }
    } catch {
      setError('Error de red al registrar');
      setSaving(false);
    }
  }

  async function anular(id: string) {
    setAnulandoId(id);
    setError(null);
    try {
      const res = await fetch(`/api/caja/gastos/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const json = (await res.json()) as { total?: number; error?: string };
      if (!res.ok) {
        setError(json.error ?? 'No se pudo quitar el gasto');
        setAnulandoId(null);
        return;
      }
      setAnulandoId(null);
      await cargarGastos();
      if (json.total != null) {
        setTotal(json.total);
        onGastosActualizados?.(json.total);
      }
    } catch {
      setError('Error de red al quitar el gasto');
      setAnulandoId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="z-[200] max-h-[min(90vh,720px)] w-[calc(100%-1.5rem)] overflow-y-auto sm:max-w-lg"
        showCloseButton
      >
        <DialogHeader>
          <DialogTitle>Gastos en efectivo</DialogTitle>
          <DialogDescription>
            Anotá los egresos de caja durante el turno. Se tendrán en cuenta automáticamente al cerrar ({cajaTexto}).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <p className="text-sm font-medium text-foreground">Nuevo gasto</p>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="grid min-w-[6rem] flex-1 gap-1 text-xs">
                <span className="text-muted-foreground">Monto</span>
                <MontoInput
                  placeholder="0"
                  className="h-9"
                  value={monto}
                  onValueChange={setMonto}
                  min={0}
                  decimals={2}
                />
              </label>
              <label className="grid min-w-0 flex-[2] gap-1 text-xs">
                <span className="text-muted-foreground">Concepto</span>
                <Input
                  placeholder="Ej.: delivery, cambio, etc."
                  value={concepto}
                  onChange={(e) => setConcepto(e.target.value)}
                  maxLength={200}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void registrar();
                    }
                  }}
                />
              </label>
              <Button
                type="button"
                size="sm"
                className="shrink-0 cursor-pointer"
                disabled={saving}
                onClick={() => void registrar()}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : 'Registrar'}
              </Button>
            </div>
          </div>

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-foreground">Gastos del turno</p>
              <p className="text-sm tabular-nums text-muted-foreground">
                Total: <span className="font-semibold text-foreground">{formatCurrency(total)}</span>
              </p>
            </div>

            {loading ? (
              <p className="mt-3 text-sm text-muted-foreground">Cargando…</p>
            ) : items.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">Todavía no hay gastos registrados en este turno.</p>
            ) : (
              <ul className="mt-2 space-y-2" aria-label="Gastos registrados">
                {items.map((g) => (
                  <li
                    key={g.id}
                    className="flex items-center gap-2 rounded-lg border border-border bg-muted/10 px-3 py-2 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-foreground">{g.concepto}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(g.created_at).toLocaleString('es-AR')}
                        {g.usuario_nombre ? ` · ${g.usuario_nombre}` : null}
                      </p>
                    </div>
                    <span className="shrink-0 font-semibold tabular-nums text-foreground">
                      {formatCurrency(g.monto)}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0 cursor-pointer text-muted-foreground hover:text-destructive"
                      disabled={anulandoId === g.id}
                      onClick={() => void anular(g.id)}
                      aria-label={`Quitar gasto ${g.concepto}`}
                    >
                      {anulandoId === g.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      ) : (
                        <Trash2 className="h-4 w-4" aria-hidden />
                      )}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
