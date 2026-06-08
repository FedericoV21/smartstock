'use client';

import { Printer } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { ReporteFiltroSucursalSelect, useReporteFiltroSucursalAdmin } from '@/components/reportes/use-reporte-filtro-sucursal-admin';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDate } from '@/lib/utils/formatters';
import type { VariantProps } from 'class-variance-authority';

type Periodo = 'hoy' | 'semana' | 'mes' | 'rango';

type ApiResumen = {
  ventas: number;
  devoluciones: number;
  costos: number;
  iva: number;
  ganancia: number;
  facturas_emitidas: number;
};

type ApiResponse = {
  periodo: { key: Periodo | string; label: string; desde: string; hasta: string };
  resumen?: ApiResumen;
  error?: string;
};

type ButtonVariant = VariantProps<typeof buttonVariants>['variant'];
type ButtonSize = VariantProps<typeof buttonVariants>['size'];

type Props = {
  triggerLabel?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
};

function filaMetrica({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2 last:border-b-0">
      <span className="font-medium text-foreground">{label}</span>
      <span className="tabular-nums text-foreground">{value}</span>
    </div>
  );
}

export function ReporteVentaCierreDialog({
  triggerLabel = 'Reporte de venta',
  variant = 'outline',
  size = 'sm',
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const { hidrato, aplicarASearchParams, mostrarSelector, opciones, sucursalId, setSucursalId } =
    useReporteFiltroSucursalAdmin();
  const [periodo, setPeriodo] = useState<Periodo>('hoy');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);

  const queryString = useMemo(() => {
    const qs = new URLSearchParams({ periodo });
    if (periodo === 'rango') {
      if (desde) qs.set('desde', desde);
      if (hasta) qs.set('hasta', hasta);
    }
    aplicarASearchParams(qs);
    return qs.toString();
  }, [periodo, desde, hasta, aplicarASearchParams]);

  const puedeCargar =
    hidrato && (periodo !== 'rango' || Boolean(desde.trim()) || Boolean(hasta.trim()));

  useEffect(() => {
    if (!open || !puedeCargar) return;
    let cancel = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/reportes/resumen-venta-periodo?${queryString}`);
        const json = (await res.json()) as ApiResponse;
        if (cancel) return;
        if (!res.ok) {
          setError(json.error ?? 'No se pudo cargar el reporte');
          setData(null);
        } else {
          setData(json);
        }
      } catch {
        if (!cancel) {
          setError('No se pudo conectar. Revisá tu red e intentá de nuevo.');
          setData(null);
        }
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [open, puedeCargar, queryString]);

  const periodoTituloImpresion = useMemo(() => {
    if (!data?.periodo) return '';
    const { desde: d, hasta: h } = data.periodo;
    if (d === h) return formatDate(d);
    return `${formatDate(d)} — ${formatDate(h)}`;
  }, [data?.periodo]);

  function handlePrint() {
    window.print();
  }

  return (
    <>
      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #reporte-venta-print-zone,
          #reporte-venta-print-zone * {
            visibility: visible;
          }
          #reporte-venta-print-zone {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            padding: 1rem;
          }
          .reporte-venta-print-hide {
            display: none !important;
          }
        }
      `}</style>

      <Button type="button" variant={variant} size={size} className={className} onClick={() => setOpen(true)}>
        {triggerLabel}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader className="reporte-venta-print-hide">
            <DialogTitle>Reporte de venta</DialogTitle>
          </DialogHeader>

          <div className="reporte-venta-print-hide space-y-3">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['hoy', 'Hoy'],
                  ['semana', 'Semana'],
                  ['mes', 'Mes'],
                  ['rango', 'Rango'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={cn(
                    'inline-flex h-8 items-center justify-center rounded-md border px-3 text-xs font-medium transition-colors',
                    periodo === key
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-input bg-background hover:bg-accent/50',
                  )}
                  onClick={() => setPeriodo(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            {periodo === 'rango' ? (
              <div className="flex flex-wrap items-end gap-2">
                <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                  Desde
                  <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="w-40" />
                </label>
                <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                  Hasta
                  <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="w-40" />
                </label>
              </div>
            ) : null}
            {mostrarSelector ? (
              <ReporteFiltroSucursalSelect opciones={opciones} value={sucursalId} onChange={setSucursalId} />
            ) : null}
          </div>

          {error ? (
            <p className="text-sm text-destructive reporte-venta-print-hide" role="alert">
              {error}
            </p>
          ) : null}

          {loading ? (
            <p className="text-sm text-muted-foreground reporte-venta-print-hide">Cargando…</p>
          ) : null}

          <div id="reporte-venta-print-zone" className="rounded-md border bg-muted/30 p-3">
            <p className="border-b border-border pb-2 text-center text-sm font-semibold tabular-nums">
              Fecha {periodoTituloImpresion || '—'}
            </p>
            {data?.resumen ? (
              <div className="pt-2 text-sm">
                {filaMetrica({ label: 'Ventas', value: formatCurrency(data.resumen.ventas) })}
                {filaMetrica({ label: 'Devoluciones', value: formatCurrency(data.resumen.devoluciones) })}
                {filaMetrica({ label: 'Costos', value: formatCurrency(data.resumen.costos) })}
                {filaMetrica({ label: 'IVA', value: formatCurrency(data.resumen.iva) })}
                {filaMetrica({ label: 'Ganancia', value: formatCurrency(data.resumen.ganancia) })}
                {filaMetrica({
                  label: 'Facturas emitidas',
                  value: String(data.resumen.facturas_emitidas),
                })}
              </div>
            ) : !loading ? (
              <p className="pt-4 text-center text-sm text-muted-foreground">
                {puedeCargar ? 'Sin datos en este período.' : 'Elegí un rango de fechas.'}
              </p>
            ) : null}
          </div>

          <DialogFooter className="reporte-venta-print-hide gap-2 sm:justify-between">
            <Button type="button" variant="outline" onClick={handlePrint} disabled={!data?.resumen}>
              <Printer className="mr-2 h-4 w-4" aria-hidden />
              Imprimir
            </Button>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
