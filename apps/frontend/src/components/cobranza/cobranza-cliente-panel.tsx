'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useDashboardRole } from '@/components/dashboard/dashboard-role-context';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { MontoInput } from '@/components/ui/monto-input';
import { formatDate } from '@/lib/utils/formatters';

type Item = {
  id: string;
  saldoPendiente: number;
  vencimientoLabel: string;
  /** ISO; si está en el futuro, el aviso de campana está pospuesto hasta esa fecha/hora. */
  recordatorioSnoozeUntil: string | null;
  numeroComprobanteLabel: string;
  tipoComprobanteLabel: string;
  saldoLabel: string;
  comprobanteId: string;
  pdfUrl: string | null;
};

export function CobranzaClientePanel({
  clienteId,
  onPagoRegistrado,
}: {
  clienteId: string;
  /** Tras un cobro exitoso: actualizar otras secciones de la página (historial, cuenta corriente, etc.). */
  onPagoRegistrado?: () => void;
}) {
  const router = useRouter();
  const { canEdit } = useDashboardRole();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [selected, setSelected] = useState<Item | null>(null);
  const [monto, setMonto] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [montoMinimoCc, setMontoMinimoCc] = useState<number | null>(null);
  const [clearingSnoozeId, setClearingSnoozeId] = useState<string | null>(null);

  function snoozeUntilLabel(iso: string | null): string | null {
    if (!iso) return null;
    const lim = new Date(iso);
    if (Number.isNaN(lim.getTime())) return null;
    return formatDate(iso);
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/cobranza?cliente_id=${encodeURIComponent(clienteId)}`);
    const json = (await res.json()) as { items?: Item[]; error?: string };
    if (!res.ok) {
      setError(json.error ?? 'Error');
      setItems([]);
    } else {
      setItems(json.items ?? []);
    }
    setLoading(false);
  }, [clienteId]);

  const loadCondiciones = useCallback(async () => {
    const res = await fetch(`/api/clientes/${clienteId}/cuenta-corriente`);
    const json = (await res.json()) as {
      cuenta?: { cobro_monto_minimo?: number } | null;
    };
    if (res.ok && json.cuenta) {
      setMontoMinimoCc(json.cuenta.cobro_monto_minimo ?? 0);
    } else {
      setMontoMinimoCc(0);
    }
  }, [clienteId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadCondiciones();
  }, [loadCondiciones]);

  function openPay(it: Item) {
    setSelected(it);
    setMonto(it.saldoPendiente > 0 ? it.saldoPendiente : null);
    setPayOpen(true);
  }

  async function clearSnooze(cobranzaId: string) {
    setClearingSnoozeId(cobranzaId);
    setError(null);
    try {
      const res = await fetch(`/api/cobranza/${cobranzaId}/snooze`, { method: 'DELETE' });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? 'No se pudo quitar el posponer');
        return;
      }
      await load();
      router.refresh();
    } finally {
      setClearingSnoozeId(null);
    }
  }

  async function submitPay() {
    if (!selected) return;
    const n = monto;
    if (n === null || n <= 0) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/cobranza/${selected.id}/pago`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monto: n, tipo_pago: 'efectivo' }),
      });
      const json = (await res.json()) as {
        error?: string;
        recibo?: { id: string; pdf_url: string | null } | null;
        recibo_error?: string | null;
      };
      if (!res.ok) {
        setError(json.error ?? 'Error al registrar');
        return;
      }
      setPayOpen(false);
      setSelected(null);
      if (json.recibo_error) {
        setError(`El cobro se registró, pero el recibo no: ${json.recibo_error}`);
      } else {
        setError(null);
      }
      await load();
      onPagoRegistrado?.();
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="mb-2 font-medium">Facturas con saldo</h2>
        <p className="text-sm text-muted-foreground">Cargando…</p>
      </section>
    );
  }

  if (items.length === 0) {
    return null;
  }

  return (
    <>
      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="mb-4 font-medium">Facturas con saldo</h2>
        {error ? <p className="mb-2 text-sm text-destructive">{error}</p> : null}
        <ul className="flex flex-col gap-3">
          {items.map((it) => (
            <li
              key={it.id}
              className="flex flex-col gap-2 rounded-lg border border-border/80 bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="font-medium">
                  {it.tipoComprobanteLabel} {it.numeroComprobanteLabel}
                </p>
                <p className="text-sm text-muted-foreground">Vence {it.vencimientoLabel}</p>
                {(() => {
                  const snoozeLbl = snoozeUntilLabel(it.recordatorioSnoozeUntil);
                  const activo =
                    snoozeLbl &&
                    it.recordatorioSnoozeUntil &&
                    new Date(it.recordatorioSnoozeUntil).getTime() > Date.now();
                  return activo ? (
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      Aviso de campana pospuesto hasta el {snoozeLbl}.{' '}
                      {canEdit ? (
                        <button
                          type="button"
                          className="font-medium underline-offset-4 hover:underline"
                          disabled={clearingSnoozeId === it.id}
                          onClick={() => void clearSnooze(it.id)}
                        >
                          {clearingSnoozeId === it.id ? 'Quitando…' : 'Volver a mostrar en la campana'}
                        </button>
                      ) : null}
                    </p>
                  ) : null;
                })()}
                <p className="text-sm">
                  Saldo: <span className="font-medium">{it.saldoLabel}</span>
                </p>
                <div className="mt-1 flex flex-wrap gap-2">
                  <Button
                    variant="link"
                    className="h-auto p-0 text-xs"
                    nativeButton={false}
                    render={<Link href={`/facturacion/${it.comprobanteId}`}>Ver comprobante</Link>}
                  />
                  {it.pdfUrl ? (
                    <Button
                      variant="link"
                      className="h-auto p-0 text-xs"
                      nativeButton={false}
                      render={
                        <a href={it.pdfUrl} target="_blank" rel="noopener noreferrer">
                          PDF
                        </a>
                      }
                    />
                  ) : null}
                </div>
              </div>
              {canEdit ? (
                <Button type="button" size="sm" onClick={() => openPay(it)}>
                  Registrar cobro
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent showCloseButton>
          <DialogHeader>
            <DialogTitle>Registrar cobro</DialogTitle>
            <DialogDescription>
              {selected
                ? `${selected.tipoComprobanteLabel} ${selected.numeroComprobanteLabel} — saldo ${selected.saldoLabel}`
                : null}
            </DialogDescription>
          </DialogHeader>
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Monto</span>
            <MontoInput
              placeholder="0,00"
              value={monto}
              onValueChange={setMonto}
              min={0}
              decimals={2}
            />
            {montoMinimoCc != null && montoMinimoCc > 0 ? (
              <span className="text-xs text-muted-foreground">
                Monto mínimo acordado: {montoMinimoCc} (salvo liquidar el saldo total).
              </span>
            ) : null}
            <span className="text-xs text-muted-foreground">
              Si cobrás de más, el excedente queda como saldo a favor del cliente.
            </span>
          </label>
          <DialogFooter showCloseButton={false}>
            <Button type="button" variant="outline" onClick={() => setPayOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void submitPay()} disabled={saving}>
              {saving ? 'Guardando…' : 'Confirmar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
