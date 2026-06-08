'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';

import { BotonDescargarPdf } from '@/components/reportes/boton-descargar-pdf';
import { ReporteInfoDialog } from '@/components/reportes/reporte-info-dialog';
import { ReporteFiltroSucursalSelect, useReporteFiltroSucursalAdmin } from '@/components/reportes/use-reporte-filtro-sucursal-admin';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { nombrePdfReporte, descargarPdfTabla } from '@/lib/reportes/pdf-informe';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDate } from '@/lib/utils/formatters';

type Periodo = 'hoy' | 'semana' | 'mes' | 'rango';
type ApiResponse = {
  periodo: { key: Periodo; desde: string; hasta: string };
  resumen: { ventas_netas: number; costo_mercaderia: number; margen_bruto: number; margen_pct: number | null };
  serie: { fecha: string; ventas: number; costo: number; margen: number }[];
  error?: string;
};

export function ReporteGananciasNetas() {
  const { hidrato, aplicarASearchParams, mostrarSelector, opciones, sucursalId, setSucursalId } =
    useReporteFiltroSucursalAdmin();
  const [periodo, setPeriodo] = useState<Periodo>('mes');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);

  const query = useMemo(() => {
    const qs = new URLSearchParams({ periodo });
    if (periodo === 'rango') {
      if (desde) qs.set('desde', desde);
      if (hasta) qs.set('hasta', hasta);
    }
    aplicarASearchParams(qs);
    return qs.toString();
  }, [periodo, desde, hasta, aplicarASearchParams]);

  useEffect(() => {
    if (!hidrato) return;
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/reportes/ganancias-netas?${query}`);
      const json = (await res.json()) as ApiResponse;
      if (!active) return;
      if (!res.ok) {
        setError(json.error ?? 'No se pudo cargar ganancias netas');
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
  }, [query, hidrato]);

  const csvHref = `/api/reportes/ganancias-netas?${query}&export=csv`;

  function generarPdf() {
    if (!data) return;
    const p = data.periodo;
    const mp = data.resumen.margen_pct;
    const filas = data.serie.map((s) => [
      formatDate(s.fecha),
      formatCurrency(s.ventas),
      formatCurrency(s.costo),
      formatCurrency(s.margen),
    ]);
    descargarPdfTabla({
      nombreArchivo: nombrePdfReporte('ganancias-netas'),
      titulo: 'Ganancias netas (estimado)',
      lineasMeta: [
        `Período: ${p.desde} → ${p.hasta}`,
        `Ventas netas: ${formatCurrency(data.resumen.ventas_netas)} · Costo mercadería: ${formatCurrency(data.resumen.costo_mercaderia)} · Margen bruto: ${formatCurrency(data.resumen.margen_bruto)}${mp != null ? ` (${mp}% s/ ventas)` : ''}`,
      ],
      encabezados: ['Fecha', 'Ventas', 'Costo', 'Margen'],
      anchosMm: [34, 52, 52, 52],
      filas,
    });
  }

  return (
    <section className="space-y-4 rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-medium">Ganancias netas</h2>
            <ReporteInfoDialog title="Ganancias netas">
              <p>Margen bruto estimado a partir de ventas netas y costo de mercadería.</p>
            </ReporteInfoDialog>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={csvHref} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'inline-flex')}>
            <Download className="mr-1 h-3.5 w-3.5" />
            Exportar CSV
          </a>
          <BotonDescargarPdf disabled={!data || loading} onGenerar={generarPdf} />
        </div>
      </div>

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
            className={cn(buttonVariants({ variant: periodo === key ? 'default' : 'outline', size: 'sm' }))}
            onClick={() => setPeriodo(key)}
          >
            {label}
          </button>
        ))}
        {periodo === 'rango' ? (
          <div className="flex items-center gap-2">
            <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="w-40" />
            <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="w-40" />
          </div>
        ) : null}
      </div>

      {mostrarSelector ? (
        <div className="flex flex-wrap gap-3">
          <ReporteFiltroSucursalSelect opciones={opciones} value={sucursalId} onChange={setSucursalId} />
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {data ? (
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Ventas netas</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{formatCurrency(data.resumen.ventas_netas)}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Costo mercaderia</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {formatCurrency(data.resumen.costo_mercaderia)}
            </p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Margen bruto</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{formatCurrency(data.resumen.margen_bruto)}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Margen %</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {data.resumen.margen_pct == null ? '-' : `${data.resumen.margen_pct.toFixed(2)}%`}
            </p>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead className="text-right">Ventas</TableHead>
              <TableHead className="text-right">Costo</TableHead>
              <TableHead className="text-right">Margen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!data || loading ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground">
                  Cargando...
                </TableCell>
              </TableRow>
            ) : data.serie.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground">
                  No hay datos para este período.
                </TableCell>
              </TableRow>
            ) : (
              data.serie.map((it) => (
                <TableRow key={it.fecha}>
                  <TableCell>{formatDate(it.fecha)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(it.ventas)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(it.costo)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(it.margen)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
