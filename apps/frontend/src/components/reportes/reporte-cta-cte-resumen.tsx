'use client';

import Link from 'next/link';
import { Download } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { BotonDescargarPdf } from '@/components/reportes/boton-descargar-pdf';
import { ReporteInfoDialog } from '@/components/reportes/reporte-info-dialog';
import { ReporteFiltroSucursalSelect, useReporteFiltroSucursalAdmin } from '@/components/reportes/use-reporte-filtro-sucursal-admin';
import { buttonVariants } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { nombrePdfReporte, descargarPdfTabla } from '@/lib/reportes/pdf-informe';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils/formatters';

type ApiResponse = {
  items: {
    cliente_id: string;
    cliente_nombre: string;
    saldo_total: number;
    estado: 'al_dia' | 'con_deuda' | 'vencido' | 'saldo_a_favor';
  }[];
  resumen: {
    deuda_total: number;
    clientes_deudores: number;
    vencidos: number;
    saldo_a_favor_total?: number;
    clientes_con_saldo_a_favor?: number;
  };
  error?: string;
};

function estadoLabel(estado: ApiResponse['items'][number]['estado']): string {
  if (estado === 'al_dia') return 'Al dia';
  if (estado === 'vencido') return 'Vencido';
  if (estado === 'saldo_a_favor') return 'Saldo a favor';
  return 'Con deuda';
}

export function ReporteCtaCteResumen() {
  const { hidrato, aplicarASearchParams, mostrarSelector, opciones, sucursalId, setSucursalId } =
    useReporteFiltroSucursalAdmin();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);

  const query = useMemo(() => {
    const qs = new URLSearchParams({ estado: 'todos' });
    aplicarASearchParams(qs);
    return qs.toString();
  }, [aplicarASearchParams]);

  useEffect(() => {
    if (!hidrato) return;
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/reportes/clientes-deuda?${query}`);
      const json = (await res.json()) as ApiResponse;
      if (!active) return;
      if (!res.ok) {
        setError(json.error ?? 'No se pudo cargar resumen de cuenta corriente');
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

  const topDeuda = useMemo(
    () => [...(data?.items ?? [])].sort((a, b) => b.saldo_total - a.saldo_total).slice(0, 10),
    [data?.items],
  );
  const csvHref = `/api/reportes/clientes-deuda?${query}&export=csv`;

  function generarPdf() {
    if (!data) return;
    const filas = topDeuda.map((it) => [
      it.cliente_nombre.length > 48 ? `${it.cliente_nombre.slice(0, 46)}…` : it.cliente_nombre,
      estadoLabel(it.estado),
      formatCurrency(Math.abs(it.saldo_total)),
    ]);
    descargarPdfTabla({
      nombreArchivo: nombrePdfReporte('cta-cte-resumen-top'),
      titulo: 'Cuenta corriente — resumen (top saldos)',
      lineasMeta: [
        `Deuda total: ${formatCurrency(data.resumen.deuda_total)} · Deudores: ${data.resumen.clientes_deudores} · Vencidos: ${data.resumen.vencidos} · A favor: ${formatCurrency(data.resumen.saldo_a_favor_total ?? 0)}`,
        'Tabla: hasta 10 clientes con mayor saldo.',
      ],
      encabezados: ['Cliente', 'Estado', 'Saldo'],
      anchosMm: [110, 28, 52],
      filas,
    });
  }

  return (
    <section className="space-y-4 rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-medium">Cuenta corriente: resumen</h2>
            <ReporteInfoDialog title="Cuenta corriente: resumen">
              <p>Estado global de deuda, saldos a favor y clientes con mayor saldo pendiente.</p>
            </ReporteInfoDialog>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/reportes/clientes" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
            Ver detalle completo
          </Link>
          <a href={csvHref} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'inline-flex')}>
            <Download className="mr-1 h-3.5 w-3.5" />
            Exportar CSV
          </a>
          <BotonDescargarPdf disabled={!data || loading} onGenerar={generarPdf} />
        </div>
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
            <p className="text-xs text-muted-foreground">Deuda total</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{formatCurrency(data.resumen.deuda_total)}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Clientes deudores</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{data.resumen.clientes_deudores}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Vencidos</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{data.resumen.vencidos}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Saldo a favor</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-emerald-700">
              {formatCurrency(data.resumen.saldo_a_favor_total ?? 0)}
            </p>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Saldo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!data || loading ? (
              <TableRow>
                <TableCell colSpan={3} className="text-muted-foreground">
                  Cargando...
                </TableCell>
              </TableRow>
            ) : topDeuda.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-muted-foreground">
                  No hay saldos pendientes.
                </TableCell>
              </TableRow>
            ) : (
              topDeuda.map((it) => (
                <TableRow key={it.cliente_id}>
                  <TableCell className="font-medium">{it.cliente_nombre}</TableCell>
                  <TableCell>
                    {estadoLabel(it.estado)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(Math.abs(it.saldo_total))}
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
