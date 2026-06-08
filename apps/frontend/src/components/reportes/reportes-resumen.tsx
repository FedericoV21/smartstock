'use client';

import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { BarChart3, Download, FileText, ReceiptText, ScanBarcode, TrendingUp, Truck, Users } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';

import { useDashboardRole } from '@/components/dashboard/dashboard-role-context';
import { BotonDescargarPdf } from '@/components/reportes/boton-descargar-pdf';
import { ReporteInfoDialog } from '@/components/reportes/reporte-info-dialog';
import { ReporteVentaCierreDialog } from '@/components/reportes/reporte-venta-cierre-dialog';
import { ReporteFiltroSucursalSelect, useReporteFiltroSucursalAdmin } from '@/components/reportes/use-reporte-filtro-sucursal-admin';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { nombrePdfReporte, descargarPdfResumen } from '@/lib/reportes/pdf-informe';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDate } from '@/lib/utils/formatters';

type Periodo = 'hoy' | 'semana' | 'mes' | 'rango';

type ResumenResponse = {
  periodo: { key: Periodo; label: string; desde: string; hasta: string };
  kpis: {
    facturado: number;
    monto_facturas_fiscales?: number;
    monto_tickets_pos?: number;
    monto_notas_credito?: number;
    comprobantes_factura?: number;
    comprobantes_ticket?: number;
    vendidos_comprobantes: number;
    deuda_cta_cte: number;
    gasto_proveedores: number;
  };
  top_proveedores: { proveedor_id: string; nombre: string; gasto: number }[];
  error?: string;
};

function KpiCard({
  title,
  value,
  href,
  cta,
  icon: Icon,
  detalle,
}: {
  title: string;
  value: string;
  href: string;
  cta: string;
  icon: LucideIcon;
  detalle?: ReactNode;
}) {
  return (
    <article className="rounded-xl border border-t-[3px] border-t-[color:var(--brand-primary)] bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <Icon className="h-5 w-5 text-[color:var(--brand-accent)]" aria-hidden />
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      {detalle ? <div className="mt-3 border-t border-border pt-3">{detalle}</div> : null}
      <Link
        href={href}
        className={cn(
          buttonVariants({ variant: 'outline', size: 'sm' }),
          'mt-4 inline-flex',
        )}
      >
        {cta}
      </Link>
    </article>
  );
}

export function ReportesResumen() {
  const { isAdmin, isSuperAdmin } = useDashboardRole();
  const { hidrato, aplicarASearchParams, mostrarSelector, opciones, sucursalId, setSucursalId } =
    useReporteFiltroSucursalAdmin();
  const [periodo, setPeriodo] = useState<Periodo>('hoy');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ResumenResponse | null>(null);

  const queryString = useMemo(() => {
    const qs = new URLSearchParams({ periodo });
    if (periodo === 'rango') {
      if (desde) qs.set('desde', desde);
      if (hasta) qs.set('hasta', hasta);
    }
    aplicarASearchParams(qs);
    return qs.toString();
  }, [periodo, desde, hasta, aplicarASearchParams]);

  const csvHref = `/api/reportes/resumen?${queryString}&export=csv`;

  useEffect(() => {
    if (!hidrato) return;
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/reportes/resumen?${queryString}`);
      const json = (await res.json()) as ResumenResponse;
      if (!active) return;
      if (!res.ok) {
        setError(json.error ?? 'No se pudo cargar el resumen');
        setData(null);
      } else {
        setData(json);
      }
      setLoading(false);
    }
    void load();
    return () => {
      active = false;
    };
  }, [queryString, hidrato]);

  function generarPdf() {
    if (!data) return;
    const p = data.periodo;
    const meta = [
      `Período: ${p.label} (${formatDate(p.desde)} → ${formatDate(p.hasta)})`,
      ...(periodo === 'rango' ? [`Rango personalizado`] : []),
    ];
    const secciones: {
      titulo: string;
      filas: { etiqueta: string; valor: string }[];
    }[] = [
      {
        titulo: 'Indicadores',
        filas: [
          {
            etiqueta: 'Con factura fiscal (A/B/C)',
            valor: formatCurrency(data.kpis.monto_facturas_fiscales ?? 0),
          },
          {
            etiqueta: 'Sin factura fiscal (ticket POS)',
            valor: formatCurrency(data.kpis.monto_tickets_pos ?? 0),
          },
          { etiqueta: 'Ingresos (neto)', valor: formatCurrency(data.kpis.facturado) },
          {
            etiqueta: 'Notas de crédito (restadas)',
            valor: formatCurrency(data.kpis.monto_notas_credito ?? 0),
          },
          { etiqueta: 'Comprobantes de venta', valor: String(data.kpis.vendidos_comprobantes) },
          { etiqueta: 'Deuda CC', valor: formatCurrency(data.kpis.deuda_cta_cte) },
          { etiqueta: 'Gasto proveedores', valor: formatCurrency(data.kpis.gasto_proveedores) },
        ],
      },
    ];
    if (data.top_proveedores.length > 0) {
      secciones.push({
        titulo: 'Top proveedores (gasto)',
        filas: data.top_proveedores.map((t) => ({
          etiqueta: t.nombre,
          valor: formatCurrency(t.gasto),
        })),
      });
    }
    descargarPdfResumen({
      nombreArchivo: nombrePdfReporte(`resumen-kpis-${p.key}`),
      titulo: 'Reporte — Resumen de período',
      lineasMeta: meta,
      secciones,
    });
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-2">
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
                  buttonVariants({ variant: periodo === key ? 'default' : 'outline', size: 'sm' }),
                )}
                onClick={() => setPeriodo(key)}
              >
                {label}
              </button>
            ))}
            {isAdmin || isSuperAdmin ? (
              <ReporteVentaCierreDialog triggerLabel="Resumen imprimible" variant="secondary" size="sm" />
            ) : null}
          </div>
          {periodo === 'rango' ? (
            <div className="flex flex-wrap items-center gap-2">
              <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="w-40" />
              <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="w-40" />
            </div>
          ) : null}
          {mostrarSelector ? (
            <ReporteFiltroSucursalSelect opciones={opciones} value={sucursalId} onChange={setSucursalId} />
          ) : null}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href={csvHref} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'inline-flex')}>
            <Download className="mr-1 h-3.5 w-3.5" />
            Exportar CSV
          </a>
          <BotonDescargarPdf disabled={!data || loading} onGenerar={generarPdf} />
        </div>
      </section>

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {!data || loading ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-40 animate-pulse rounded-xl border bg-card" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">Ventas del período: facturado vs. ticket</h3>
              <ReporteInfoDialog title="Ventas del período: facturado vs. ticket" buttonLabel="Ver criterio">
                <p>
                  Compara lo emitido como factura fiscal frente a ventas solo con ticket de POS, que no son factura
                  A/B/C.
                </p>
                <p>El neto incluye facturas y tickets, menos notas de crédito cuando existen.</p>
              </ReporteInfoDialog>
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <KpiCard
                title="Con factura fiscal (A/B/C)"
                value={formatCurrency(data.kpis.monto_facturas_fiscales ?? 0)}
                href="/facturacion"
                cta="Ver en facturación"
                icon={FileText}
                detalle={
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    <span className="tabular-nums font-medium text-foreground">
                      {data.kpis.comprobantes_factura ?? 0} comprobante(s)
                    </span>{' '}
                    emitidos como factura A, B o C en el rango de fechas.
                  </p>
                }
              />
              <KpiCard
                title="Sin factura fiscal (solo ticket POS)"
                value={formatCurrency(data.kpis.monto_tickets_pos ?? 0)}
                href="/facturacion/pos"
                cta="Ir al POS"
                icon={ScanBarcode}
                detalle={
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    <span className="tabular-nums font-medium text-foreground">
                      {data.kpis.comprobantes_ticket ?? 0} ticket(s)
                    </span>{' '}
                    del período. En el sistema son comprobante tipo ticket; no reemplazan una factura fiscal.
                  </p>
                }
              />
              <KpiCard
                title="Ingresos netos del período"
                value={formatCurrency(data.kpis.facturado)}
                href="/facturacion"
                cta="Ver todos"
                icon={TrendingUp}
                detalle={
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Facturas + tickets
                    {(data.kpis.monto_notas_credito ?? 0) > 0
                      ? `, menos notas de crédito (−${formatCurrency(data.kpis.monto_notas_credito ?? 0)})`
                      : '.'}
                  </p>
                }
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <KpiCard
              title="Comprobantes de venta (total)"
              value={String(data.kpis.vendidos_comprobantes)}
              href="/facturacion"
              cta="Ver listado"
              icon={ReceiptText}
              detalle={
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Suma de facturas y tickets:{' '}
                  <span className="tabular-nums text-foreground">
                    {(data.kpis.comprobantes_factura ?? 0) + (data.kpis.comprobantes_ticket ?? 0)}
                  </span>{' '}
                  comprobantes.
                </p>
              }
            />
            <KpiCard
              title="Deuda de cuenta corriente"
              value={formatCurrency(data.kpis.deuda_cta_cte)}
              href="/analizador/cuenta-corriente"
              cta="Ver cuenta corriente"
              icon={Users}
            />
            <KpiCard
              title="Gasto asociado a proveedores"
              value={formatCurrency(data.kpis.gasto_proveedores)}
              href="/proveedores"
              cta="Ver proveedores"
              icon={Truck}
            />
          </div>
        </div>
      )}

      {data ? (
        <section className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-[color:var(--brand-accent)]" />
            <h2 className="font-medium">Top proveedores del período</h2>
          </div>
          {data.top_proveedores.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay datos suficientes para construir ranking de proveedores en este rango.
            </p>
          ) : (
            <ul className="space-y-2">
              {data.top_proveedores.map((p) => (
                <li
                  key={p.proveedor_id}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                >
                  <span className="font-medium">{p.nombre}</span>
                  <span className="tabular-nums text-muted-foreground">{formatCurrency(p.gasto)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
