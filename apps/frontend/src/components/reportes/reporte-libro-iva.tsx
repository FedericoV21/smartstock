'use client';

import { Download } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

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
  resumen: { neto_gravado: number; iva_neto: number; total_comprobantes: number; cantidad: number };
  por_alicuota: { alicuota: number; neto: number; iva: number; total: number }[];
  items: { id: string; fecha: string; tipo: string; numero: number; alicuota: number; neto: number; iva: number; total: number }[];
  error?: string;
};

export function ReporteLibroIva() {
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
      const res = await fetch(`/api/reportes/libro-iva?${query}`);
      const json = (await res.json()) as ApiResponse;
      if (!active) return;
      if (!res.ok) {
        setError(json.error ?? 'No se pudo cargar libro IVA');
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

  const csvHref = `/api/reportes/libro-iva?${query}&export=csv`;

  function generarPdf() {
    if (!data) return;
    const p = data.periodo;
    const filas = data.items.map((it) => [
      formatDate(it.fecha),
      String(it.tipo).replaceAll('_', ' '),
      String(it.numero),
      String(it.alicuota),
      formatCurrency(it.neto),
      formatCurrency(it.iva),
      formatCurrency(it.total),
    ]);
    descargarPdfTabla({
      nombreArchivo: nombrePdfReporte('libro-iva-ventas'),
      titulo: 'Libro IVA (ventas)',
      lineasMeta: [
        `Período: ${p.desde} → ${p.hasta}`,
        `Comprobantes: ${data.resumen.cantidad} · Neto gravado: ${formatCurrency(data.resumen.neto_gravado)} · IVA: ${formatCurrency(data.resumen.iva_neto)} · Total: ${formatCurrency(data.resumen.total_comprobantes)}`,
      ],
      encabezados: ['Fecha', 'Tipo', 'Nº', '% IVA', 'Neto', 'IVA', 'Total'],
      anchosMm: [24, 36, 14, 14, 30, 30, 42],
      filas,
    });
  }

  return (
    <section className="space-y-4 rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-medium">Libro IVA (ventas)</h2>
            <ReporteInfoDialog title="Libro IVA (ventas)">
              <p>Neto gravado, IVA y total por comprobante, con corte por alícuota.</p>
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
            <p className="text-xs text-muted-foreground">Comprobantes</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{data.resumen.cantidad}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Neto gravado</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{formatCurrency(data.resumen.neto_gravado)}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">IVA neto</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{formatCurrency(data.resumen.iva_neto)}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {formatCurrency(data.resumen.total_comprobantes)}
            </p>
          </div>
        </div>
      ) : null}

      {data?.por_alicuota?.length ? (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Alicuota</TableHead>
                <TableHead className="text-right">Neto</TableHead>
                <TableHead className="text-right">IVA</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.por_alicuota.map((it) => (
                <TableRow key={String(it.alicuota)}>
                  <TableCell>{it.alicuota}%</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(it.neto)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(it.iva)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(it.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Nro.</TableHead>
              <TableHead className="text-right">Neto</TableHead>
              <TableHead className="text-right">IVA</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!data || loading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground">
                  Cargando...
                </TableCell>
              </TableRow>
            ) : data.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground">
                  No hay comprobantes en el período seleccionado.
                </TableCell>
              </TableRow>
            ) : (
              data.items.map((it) => (
                <TableRow key={it.id}>
                  <TableCell>{formatDate(it.fecha)}</TableCell>
                  <TableCell>{it.tipo}</TableCell>
                  <TableCell>{it.numero}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(it.neto)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(it.iva)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(it.total)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
