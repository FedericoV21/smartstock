'use client';

import { CheckCircle2, Printer } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { GastosCajaLineasEditor, type GastoLineaBorrador } from '@/components/caja/gastos-caja-lineas-editor';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MontoInput } from '@/components/ui/monto-input';
import { redondear2 } from '@/lib/caja/cierre-z-calculo';
import type { CierreCajaTicketResumen } from '@/lib/caja/cierre-ticket-resumen';
import { etiquetaMetodoPagoCierre } from '@/lib/caja/etiqueta-metodo-pago-cierre';
import type { CajaGastoSesionRow } from '@/lib/caja/caja-gastos-sesion';
import { compactarGastosDesdeBorrador } from '@/lib/caja/gastos-cierre';
import { printCierreCajaTicket, type CierreCajaTicketMeta } from '@/lib/caja/ticket-cierre-caja';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils/formatters';

type Snapshot = {
  efectivo_esperado: number;
  fondo_apertura?: number;
  efectivo_ventas_periodo?: number;
  efectivo_cobros_cc_manual?: number;
  modo_periodo?: string;
  total_comprobantes: number;
  ventas_netas: number;
  pagos_cta_cte_total: number;
  medios: { metodo_pago: string; monto_neto: number; cantidad_comprobantes: number }[];
};

type AperturaVigente = {
  id: string;
  opened_at: string;
  fondo_efectivo: number;
  fecha_operativa: string;
};

export function PosCierreCajaModal({
  open,
  onOpenChange,
  fechaOperativa = null,
  cajaId = null,
  sucursalId = null,
  cajaEtiqueta = null,
  onCierreRegistrado,
  preferirModoSesionApertura = false,
  anchoTicket = '80mm',
  tenantNombre = 'Smart Stock',
  tenantLogoUrl = null,
  tenantCuit = null,
  tenantDomicilio = null,
  cajeroNombre = null,
  mostrarResumenCierreCaja = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Compatibilidad: el cierre rapido POS siempre usa la sesion abierta. */
  fechaOperativa?: string | null;
  cajaId?: string | null;
  sucursalId?: string | null;
  /** Texto legible (p. ej. turno de caja); si viene, se muestra en lugar del id tecnico. */
  cajaEtiqueta?: string | null;
  onCierreRegistrado?: () => void | Promise<void>;
  /** Compatibilidad: el POS ahora fuerza modo sesion. */
  preferirModoSesionApertura?: boolean;
  anchoTicket?: '80mm' | '57mm';
  tenantNombre?: string | null;
  tenantLogoUrl?: string | null;
  tenantCuit?: string | null;
  tenantDomicilio?: string | null;
  cajeroNombre?: string | null;
  mostrarResumenCierreCaja?: boolean;
}) {
  const [efectivoContado, setEfectivoContado] = useState<number | null>(null);
  const [gastosLineas, setGastosLineas] = useState<GastoLineaBorrador[]>([]);
  const [gastosSesion, setGastosSesion] = useState<CajaGastoSesionRow[]>([]);
  const [totalGastosSesion, setTotalGastosSesion] = useState(0);
  const [preview, setPreview] = useState<Snapshot | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aperturaVigente, setAperturaVigente] = useState<AperturaVigente | null>(null);
  const [ticketResumen, setTicketResumen] = useState<CierreCajaTicketResumen | null>(null);
  const [gastosSesionLoading, setGastosSesionLoading] = useState(false);
  const modalEstabaAbiertoRef = useRef(false);

  const queryCajaSesion = useCallback(() => {
    const qs = new URLSearchParams();
    if (cajaId?.trim()) qs.set('caja_id', cajaId.trim());
    if (sucursalId?.trim()) qs.set('sucursal_id', sucursalId.trim());
    return qs;
  }, [cajaId, sucursalId]);

  const gastosCompact = useMemo(() => compactarGastosDesdeBorrador(gastosLineas), [gastosLineas]);
  const totalGastosAdicionales = gastosCompact.ok ? gastosCompact.total : 0;
  const totalGastos = redondear2(totalGastosSesion + totalGastosAdicionales);

  const esperadoAjustado =
    mostrarResumenCierreCaja && preview !== null ? redondear2(preview.efectivo_esperado - totalGastos) : null;
  const diferencia =
    mostrarResumenCierreCaja && preview !== null && efectivoContado !== null && esperadoAjustado !== null
      ? redondear2(efectivoContado - esperadoAjustado)
      : null;

  const cajaTexto = cajaEtiqueta?.trim() || cajaId?.trim() || 'Sin identificador de caja';
  const ticketMeta: CierreCajaTicketMeta = {
    tenantNombre: tenantNombre?.trim() || 'Smart Stock',
    logoUrl: tenantLogoUrl,
    tenantCuit,
    tenantDomicilio,
    cajaEtiqueta: cajaEtiqueta?.trim() || null,
    cajeroNombre,
  };

  const cargarEstadoApertura = useCallback(async () => {
    const res = await fetch(`/api/caja/apertura?${queryCajaSesion().toString()}`, { cache: 'no-store' });
    const json = (await res.json()) as { vigente?: AperturaVigente | null; error?: string };
    if (!res.ok) {
      setAperturaVigente(null);
      return;
    }
    setAperturaVigente(json.vigente ?? null);
  }, [queryCajaSesion]);

  const cargarGastosSesion = useCallback(async () => {
    if (!cajaId?.trim()) {
      setGastosSesion([]);
      setTotalGastosSesion(0);
      return;
    }
    setGastosSesionLoading(true);
    try {
      const res = await fetch(`/api/caja/gastos?${queryCajaSesion().toString()}`, { cache: 'no-store' });
      const json = (await res.json()) as {
        items?: CajaGastoSesionRow[];
        total?: number;
        error?: string;
      };
      if (!res.ok) {
        setGastosSesion([]);
        setTotalGastosSesion(0);
        return;
      }
      setGastosSesion(json.items ?? []);
      setTotalGastosSesion(Number(json.total ?? 0));
    } catch {
      setGastosSesion([]);
      setTotalGastosSesion(0);
    } finally {
      setGastosSesionLoading(false);
    }
  }, [cajaId, queryCajaSesion]);

  const cargarPreview = useCallback(async () => {
    setPreviewLoading(true);
    setError(null);
    const qs = queryCajaSesion();
    qs.set('preview', '1');
    qs.set('modo_periodo', 'sesion_apertura');
    qs.set('tipo_cierre', 'diario');

    const res = await fetch(`/api/caja/cierre-z?${qs.toString()}`, { cache: 'no-store' });
    const json = (await res.json()) as {
      snapshot?: Snapshot;
      gastos_sesion?: CajaGastoSesionRow[];
      total_gastos_sesion?: number;
      error?: string;
    };
    if (!res.ok) {
      setPreview(null);
      setError(json.error ?? 'No se pudo calcular la caja abierta');
    } else {
      setPreview(json.snapshot ?? null);
      if (json.gastos_sesion != null) {
        setGastosSesion(json.gastos_sesion);
        setTotalGastosSesion(Number(json.total_gastos_sesion ?? 0));
      }
    }
    setPreviewLoading(false);
  }, [queryCajaSesion]);

  useEffect(() => {
    if (!open) {
      modalEstabaAbiertoRef.current = false;
      return;
    }
    if (modalEstabaAbiertoRef.current) return;
    modalEstabaAbiertoRef.current = true;
    queueMicrotask(() => {
      void fechaOperativa;
      void preferirModoSesionApertura;
      setEfectivoContado(null);
      setGastosLineas([]);
      setGastosSesion([]);
      setTotalGastosSesion(0);
      setPreview(null);
      setError(null);
      setAperturaVigente(null);
      setTicketResumen(null);
    });
  }, [open, fechaOperativa, preferirModoSesionApertura]);

  useEffect(() => {
    if (!open || ticketResumen) return;
    queueMicrotask(() => {
      void cargarEstadoApertura();
      void cargarGastosSesion();
    });
  }, [open, ticketResumen, cargarEstadoApertura, cargarGastosSesion]);

  useEffect(() => {
    if (!open || ticketResumen || !mostrarResumenCierreCaja) return;
    queueMicrotask(() => void cargarPreview());
  }, [open, ticketResumen, cargarPreview, mostrarResumenCierreCaja]);

  async function confirmar() {
    if (efectivoContado === null) {
      setError('Ingresa cuanto efectivo tenes en la caja.');
      return;
    }
    if (!gastosCompact.ok) {
      setError(gastosCompact.error);
      return;
    }
    setSaving(true);
    setError(null);
    const body: Record<string, unknown> = {
      caja_id: cajaId?.trim() || null,
      sucursal_id: sucursalId?.trim() || null,
      modo_periodo: 'sesion_apertura',
      tipo_cierre: 'diario',
      rango_desde_hora: null,
      rango_hasta_hora: null,
      efectivo_contado: efectivoContado,
      jornada: null,
      origen_ui: 'pos_modal_rapido',
    };
    if (gastosCompact.items.length > 0) {
      body.gastos_items = gastosCompact.items;
    }
    const res = await fetch('/api/caja/cierre-z', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as {
      error?: string;
      snapshot?: Snapshot;
      ticket_resumen?: CierreCajaTicketResumen;
    };
    if (!res.ok) {
      setError(json.error ?? 'No se pudo guardar el cierre');
      setSaving(false);
      return;
    }

    setSaving(false);
    if (json.snapshot) setPreview(json.snapshot);
    if (!mostrarResumenCierreCaja) {
      setTicketResumen(null);
      await onCierreRegistrado?.();
      onOpenChange(false);
      return;
    }
    setTicketResumen(json.ticket_resumen ?? null);
    await onCierreRegistrado?.();
  }

  function imprimirTicket() {
    if (!ticketResumen) return;
    printCierreCajaTicket(ticketResumen, ticketMeta, anchoTicket);
  }

  function cerrarModal() {
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="z-[200] max-h-[min(90vh,720px)] w-[calc(100%-1.5rem)] overflow-y-auto sm:max-w-lg"
        showCloseButton
      >
        <DialogHeader>
          <DialogTitle>Cierre de caja</DialogTitle>
          <DialogDescription>
            Cierra la caja abierta desde la ultima apertura hasta este momento. Para cierres por fecha o franjas,
            usa el panel avanzado de Caja.
          </DialogDescription>
        </DialogHeader>

        {ticketResumen ? (
          <div className="space-y-4">
            <div
              className="flex gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-950 dark:text-emerald-100"
              role="status"
              aria-live="polite"
            >
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
              <div>
                <p className="font-semibold text-foreground">Cierre registrado</p>
                <p>La caja quedo cerrada. Ya podes imprimir el resumen en formato ticket.</p>
              </div>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
              <p className="font-medium text-foreground">Resumen</p>
              <dl className="mt-2 grid gap-1 text-muted-foreground">
                <div className="flex justify-between gap-3">
                  <dt>Caja</dt>
                  <dd className="text-right font-medium text-foreground">{cajaTexto}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Comprobantes</dt>
                  <dd className="font-medium tabular-nums text-foreground">
                    {ticketResumen.snapshot.total_comprobantes}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Ventas netas</dt>
                  <dd className="font-medium tabular-nums text-foreground">
                    {formatCurrency(ticketResumen.snapshot.ventas_netas)}
                  </dd>
                </div>
                {ticketResumen.arqueo_efectivo ? (
                  <>
                    <div className="flex justify-between gap-3">
                      <dt>Contado</dt>
                      <dd className="font-medium tabular-nums text-foreground">
                        {formatCurrency(ticketResumen.arqueo_efectivo.contado)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt>Diferencia</dt>
                      <dd
                        className={cn(
                          'font-semibold tabular-nums',
                          Math.abs(ticketResumen.arqueo_efectivo.diferencia) < 0.005
                            ? 'text-emerald-700 dark:text-emerald-300'
                            : 'text-amber-700 dark:text-amber-300',
                        )}
                      >
                        {formatCurrency(ticketResumen.arqueo_efectivo.diferencia)}
                      </dd>
                    </div>
                  </>
                ) : null}
              </dl>
            </div>
            <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" className="cursor-pointer gap-2" onClick={imprimirTicket}>
                <Printer className="h-4 w-4" aria-hidden />
                Imprimir ticket
              </Button>
              <Button type="button" className="cursor-pointer" onClick={cerrarModal}>
                Cerrar
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm">
                <p className="font-medium text-foreground">Caja actual</p>
                <p className="mt-1 text-muted-foreground">
                  <span className="font-medium text-foreground">{cajaTexto}</span>
                </p>
                {aperturaVigente ? (
                  <p className="mt-2 text-muted-foreground">
                    Fondo inicial{' '}
                    <span className="font-semibold tabular-nums text-foreground">
                      {formatCurrency(aperturaVigente.fondo_efectivo)}
                    </span>{' '}
                    desde{' '}
                    <span className="tabular-nums text-foreground">
                      {new Date(aperturaVigente.opened_at).toLocaleString('es-AR')}
                    </span>
                  </p>
                ) : (
                  <p className="mt-2 text-muted-foreground">
                    No hay una apertura vigente para cerrar desde este modal.
                  </p>
                )}
              </div>

              {!mostrarResumenCierreCaja ? (
                <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                  <p className="font-medium text-foreground">Cierre rápido</p>
                  <p className="mt-1 text-muted-foreground">
                    Contá el efectivo disponible y cargá el total en <span className="font-medium">Efectivo contado en caja</span>.
                    Luego cerrá la caja.
                  </p>
                  {gastosSesionLoading ? (
                    <p className="mt-2 text-xs text-muted-foreground">Cargando gastos del turno…</p>
                  ) : totalGastosSesion > 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Los gastos del turno ({formatCurrency(totalGastosSesion)}) se descontarán automáticamente del
                      arqueo al confirmar.
                    </p>
                  ) : null}
                </div>
              ) : previewLoading ? (
                <p className="text-sm text-muted-foreground">Calculando movimientos...</p>
              ) : preview ? (
                <div className="rounded-lg border border-dashed border-border bg-muted/30 p-3 text-sm">
                  <p className="font-medium text-foreground">Segun el sistema</p>
                  <ul className="mt-2 space-y-1 text-muted-foreground">
                    <li>
                      Fondo al abrir:{' '}
                      <span className="font-semibold tabular-nums text-foreground">
                        {formatCurrency(preview.fondo_apertura ?? 0)}
                      </span>
                    </li>
                    <li>
                      + Ventas en efectivo:{' '}
                      <span className="font-semibold tabular-nums text-foreground">
                        {formatCurrency(preview.efectivo_ventas_periodo ?? 0)}
                      </span>
                    </li>
                    {(preview.efectivo_cobros_cc_manual ?? 0) > 0 ? (
                      <li>
                        + Cobros en efectivo desde cuenta corriente:{' '}
                        <span className="font-semibold tabular-nums text-foreground">
                          {formatCurrency(preview.efectivo_cobros_cc_manual ?? 0)}
                        </span>
                      </li>
                    ) : null}
                    {totalGastosSesion > 0 ? (
                      <li>
                        - Gastos del turno:{' '}
                        <span className="tabular-nums text-foreground">{formatCurrency(totalGastosSesion)}</span>
                      </li>
                    ) : null}
                    {totalGastosAdicionales > 0 ? (
                      <li>
                        - Gastos adicionales al cierre:{' '}
                        <span className="tabular-nums text-foreground">
                          {formatCurrency(totalGastosAdicionales)}
                        </span>
                      </li>
                    ) : null}
                    <li>
                      Referencia para arqueo:{' '}
                      <span className="font-semibold tabular-nums text-foreground">
                        {formatCurrency(esperadoAjustado ?? preview.efectivo_esperado)}
                      </span>
                    </li>
                    <li className="text-xs">Comprobantes: {preview.total_comprobantes}</li>
                    <li className="text-xs">
                      Ventas netas:{' '}
                      <span className="font-semibold tabular-nums text-foreground">
                        {formatCurrency(preview.ventas_netas)}
                      </span>
                    </li>
                    {preview.pagos_cta_cte_total > 0 ? (
                      <li className="text-xs">
                        Cobros cuenta cliente:{' '}
                        <span className="font-semibold tabular-nums text-foreground">
                          {formatCurrency(preview.pagos_cta_cte_total)}
                        </span>
                      </li>
                    ) : null}
                  </ul>
                  {preview.medios.length > 0 ? (
                    <div className="mt-3 border-t border-border pt-3">
                      <p className="text-xs font-medium text-foreground">Ingresos por metodo de pago</p>
                      <ul className="mt-2 space-y-1.5 text-sm">
                        {preview.medios.map((m) => (
                          <li
                            key={m.metodo_pago}
                            className="flex flex-wrap items-baseline justify-between gap-2 text-muted-foreground"
                          >
                            <span>{etiquetaMetodoPagoCierre(m.metodo_pago)}</span>
                            <span className="font-semibold tabular-nums text-foreground">
                              {formatCurrency(m.monto_neto)}
                              <span className="ml-1 text-xs font-normal text-muted-foreground">
                                ({m.cantidad_comprobantes})
                              </span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">Efectivo contado en caja</span>
                <MontoInput
                  placeholder="0,00"
                  value={efectivoContado}
                  onValueChange={setEfectivoContado}
                  min={0}
                  decimals={2}
                  className="text-base"
                  autoComplete="off"
                />
              </label>

              {gastosSesionLoading ? (
                <p className="text-sm text-muted-foreground">Cargando gastos del turno…</p>
              ) : gastosSesion.length > 0 ? (
                <div className="space-y-2 rounded-lg border border-amber-500/35 bg-amber-500/10 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">Gastos del turno</p>
                    <p className="text-sm font-semibold tabular-nums text-foreground">
                      {formatCurrency(totalGastosSesion)}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Se incluirán automáticamente en el cierre; no hace falta volver a cargarlos.
                  </p>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {gastosSesion.map((g) => (
                      <li key={g.id} className="flex justify-between gap-2">
                        <span className="min-w-0 truncate">{g.concepto}</span>
                        <span className="shrink-0 tabular-nums text-foreground">{formatCurrency(g.monto)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <GastosCajaLineasEditor
                lineas={gastosLineas}
                onChange={setGastosLineas}
                titulo="Gastos adicionales al cierre (opcional)"
                descripcion="Solo para egresos que no registraste durante el turno en el POS."
              />

              {mostrarResumenCierreCaja && diferencia !== null ? (
                <p
                  className={cn(
                    'rounded-md border px-3 py-2 text-sm tabular-nums',
                    Math.abs(diferencia) < 0.005
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-950 dark:text-emerald-100'
                      : 'border-amber-500/40 bg-amber-500/10 text-amber-950 dark:text-amber-100',
                  )}
                  role="status"
                >
                  Diferencia (contado - referencia): <span className="font-semibold">{formatCurrency(diferencia)}</span>
                </p>
              ) : null}

              {error ? (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
              {mostrarResumenCierreCaja ? (
                <Button
                  type="button"
                  variant="outline"
                  className="cursor-pointer"
                  onClick={() => {
                    void cargarGastosSesion();
                    void cargarPreview();
                  }}
                >
                  Recalcular
                </Button>
              ) : null}
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="ghost" className="cursor-pointer" onClick={cerrarModal}>
                  Cancelar
                </Button>
                <Button
                  type="button"
                  className="cursor-pointer"
                  disabled={
                    saving ||
                    (!mostrarResumenCierreCaja ? false : previewLoading || !preview) ||
                    !aperturaVigente ||
                    !gastosCompact.ok ||
                    efectivoContado === null
                  }
                  onClick={() => void confirmar()}
                >
                  {saving ? 'Guardando...' : 'Confirmar cierre'}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
