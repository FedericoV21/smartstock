'use client';

import Link from 'next/link';
import { Download, Truck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { BotonDescargarPdf } from '@/components/reportes/boton-descargar-pdf';
import { ReporteInfoDialog } from '@/components/reportes/reporte-info-dialog';
import { ReporteFiltroSucursalSelect, useReporteFiltroSucursalAdmin } from '@/components/reportes/use-reporte-filtro-sucursal-admin';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { nombrePdfReporte, descargarPdfTabla } from '@/lib/reportes/pdf-informe';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils/formatters';

type Periodo = 'hoy' | 'semana' | 'mes' | 'rango';

type ApiResponse = {
  periodo: { key: Periodo; desde: string; hasta: string };
  comparativo: { desde: string; hasta: string };
  filtro: { proveedor_id: string | null };
  items: {
    proveedor_id: string;
    proveedor_nombre: string;
    gasto_actual: number;
    gasto_anterior: number;
    variacion_abs: number;
    variacion_pct: number | null;
  }[];
  resumen: {
    total_actual: number;
    total_anterior: number;
    variacion_abs: number;
    variacion_pct: number | null;
  };
  proveedores: { id: string; nombre: string }[];
  error?: string;
};

function pctLabel(n: number | null): string {
  if (n == null) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

export function ReporteProveedoresGasto() {
  const { hidrato, aplicarASearchParams, mostrarSelector, opciones, sucursalId, setSucursalId } =
    useReporteFiltroSucursalAdmin();
  const [periodo, setPeriodo] = useState<Periodo>('mes');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [proveedorId, setProveedorId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);

  const qs = useMemo(() => {
    const p = new URLSearchParams({ periodo });
    if (periodo === 'rango') {
      if (desde) p.set('desde', desde);
      if (hasta) p.set('hasta', hasta);
    }
    if (proveedorId) p.set('proveedor_id', proveedorId);
    aplicarASearchParams(p);
    return p.toString();
  }, [periodo, desde, hasta, proveedorId, aplicarASearchParams]);

  useEffect(() => {
    if (!hidrato) return;
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/reportes/proveedores-gasto?${qs}`);
      const json = (await res.json()) as ApiResponse;
      if (!active) return;
      if (!res.ok) {
        setError(json.error ?? 'No se pudo cargar reporte de proveedores');
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
  }, [qs, hidrato]);

  const csvHref = `/api/reportes/proveedores-gasto?${qs}&export=csv`;

  function generarPdf() {
    if (!data) return;
    const p = data.periodo;
    const filas = data.items.map((it) => [
      it.proveedor_nombre.length > 40 ? `${it.proveedor_nombre.slice(0, 38)}…` : it.proveedor_nombre,
      formatCurrency(it.gasto_actual),
      formatCurrency(it.gasto_anterior),
      formatCurrency(it.variacion_abs),
      pctLabel(it.variacion_pct),
    ]);
    descargarPdfTabla({
      nombreArchivo: nombrePdfReporte('proveedores-gasto'),
      titulo: 'Proveedores — gasto comparativo',
      lineasMeta: [
        `Período actual: ${p.desde} → ${p.hasta}`,
        `Comparativo anterior: ${data.comparativo.desde} → ${data.comparativo.hasta}`,
        `Totales — actual: ${formatCurrency(data.resumen.total_actual)} · anterior: ${formatCurrency(data.resumen.total_anterior)} · variación: ${formatCurrency(data.resumen.variacion_abs)} (${pctLabel(data.resumen.variacion_pct)})`,
      ],
      encabezados: ['Proveedor', 'Gasto actual', 'Gasto ant.', 'Variación $', 'Variación %'],
      anchosMm: [70, 32, 32, 28, 28],
      filas,
    });
  }

  return (
    <section className="space-y-4 rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-medium">Proveedores: gasto y comparativo</h2>
            <ReporteInfoDialog title="Proveedores: gasto y comparativo">
              <p>Total por proveedor en el período actual contra el período anterior equivalente.</p>
            </ReporteInfoDialog>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={csvHref}
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'inline-flex')}
          >
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
      </div>

      <div className="flex flex-wrap gap-2">
        {periodo === 'rango' ? (
          <>
            <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="w-40" />
            <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="w-40" />
          </>
        ) : null}
        <select
          value={proveedorId}
          onChange={(e) => setProveedorId(e.target.value)}
          className="h-9 min-w-[240px] rounded-md border border-input bg-transparent px-3 text-sm"
        >
          <option value="">Todos los proveedores</option>
          {(data?.proveedores ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </select>
        {mostrarSelector ? (
          <ReporteFiltroSucursalSelect opciones={opciones} value={sucursalId} onChange={setSucursalId} />
        ) : null}
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {data ? (
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Total actual</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{formatCurrency(data.resumen.total_actual)}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Total anterior</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{formatCurrency(data.resumen.total_anterior)}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Variación total</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {formatCurrency(data.resumen.variacion_abs)} ({pctLabel(data.resumen.variacion_pct)})
            </p>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Proveedor</TableHead>
              <TableHead className="text-right">Actual</TableHead>
              <TableHead className="text-right">Anterior</TableHead>
              <TableHead className="text-right">Variación</TableHead>
              <TableHead className="text-right">Variación %</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!data || loading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground">
                  Cargando…
                </TableCell>
              </TableRow>
            ) : data.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground">
                  No hay datos para el rango y filtro seleccionado.
                </TableCell>
              </TableRow>
            ) : (
              data.items.map((it) => (
                <TableRow key={it.proveedor_id}>
                  <TableCell className="font-medium">{it.proveedor_nombre}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(it.gasto_actual)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(it.gasto_anterior)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(it.variacion_abs)}</TableCell>
                  <TableCell
                    className={cn(
                      'text-right tabular-nums',
                      (it.variacion_pct ?? 0) > 0
                        ? 'text-amber-700'
                        : (it.variacion_pct ?? 0) < 0
                          ? 'text-emerald-700'
                          : 'text-muted-foreground',
                    )}
                  >
                    {pctLabel(it.variacion_pct)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/proveedores/${it.proveedor_id}`}
                      className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'inline-flex')}
                    >
                      <Truck className="mr-1 h-3.5 w-3.5" />
                      Ver proveedor
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
