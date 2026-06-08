'use client';

import Link from 'next/link';
import { AlertTriangle, CalendarClock, CircleCheck, Download, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { BotonDescargarPdf } from '@/components/reportes/boton-descargar-pdf';
import { ReporteInfoDialog } from '@/components/reportes/reporte-info-dialog';
import { ReporteFiltroSucursalSelect, useReporteFiltroSucursalAdmin } from '@/components/reportes/use-reporte-filtro-sucursal-admin';
import { buttonVariants } from '@/components/ui/button';
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

type EstadoCuentaCliente = 'al_dia' | 'con_deuda' | 'vencido' | 'saldo_a_favor';
type EstadoFiltro = 'todos' | EstadoCuentaCliente;

type ApiResponse = {
  items: {
    cliente_id: string;
    cliente_nombre: string;
    saldo_total: number;
    estado: EstadoCuentaCliente;
    aging_0_30: number;
    aging_31_60: number;
    aging_61_plus: number;
    facturas_abiertas: number;
    facturas_vencidas: number;
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

function estadoClienteLabel(estado: EstadoCuentaCliente): string {
  if (estado === 'al_dia') return 'Al dia';
  if (estado === 'vencido') return 'Vencido';
  if (estado === 'saldo_a_favor') return 'Saldo a favor';
  return 'Con deuda';
}

export function ReporteClientesDeuda() {
  const { hidrato, aplicarASearchParams, mostrarSelector, opciones, sucursalId, setSucursalId } =
    useReporteFiltroSucursalAdmin();
  const [estado, setEstado] = useState<EstadoFiltro>('todos');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);

  const query = useMemo(() => {
    const qs = new URLSearchParams({ estado });
    aplicarASearchParams(qs);
    return qs.toString();
  }, [estado, aplicarASearchParams]);

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
        setError(json.error ?? 'No se pudo cargar reporte de clientes');
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

  const csvHref = `/api/reportes/clientes-deuda?${query}&export=csv`;

  function generarPdf() {
    if (!data) return;
    const filas = data.items.map((it) => [
      it.cliente_nombre.length > 36 ? `${it.cliente_nombre.slice(0, 34)}…` : it.cliente_nombre,
      estadoClienteLabel(it.estado),
      formatCurrency(Math.abs(it.saldo_total)),
      formatCurrency(it.aging_0_30),
      formatCurrency(it.aging_31_60),
      formatCurrency(it.aging_61_plus),
      String(it.facturas_abiertas),
      String(it.facturas_vencidas),
    ]);
    descargarPdfTabla({
      nombreArchivo: nombrePdfReporte(`clientes-deuda-${estado}`),
      titulo: 'Clientes — deuda y cobranza',
      lineasMeta: [
        `Filtro estado: ${estado}`,
        `Deuda total: ${formatCurrency(data.resumen.deuda_total)} · Deudores: ${data.resumen.clientes_deudores} · Vencidos: ${data.resumen.vencidos} · A favor: ${formatCurrency(data.resumen.saldo_a_favor_total ?? 0)}`,
      ],
      encabezados: ['Cliente', 'Estado', 'Saldo', '0-30', '31-60', '61+', 'F. abiertas', 'F. venc.'],
      anchosMm: [60, 18, 22, 20, 20, 20, 16, 14],
      filas,
    });
  }

  return (
    <section className="space-y-4 rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-medium">Clientes: deuda y vencimientos</h2>
            <ReporteInfoDialog title="Clientes: deuda y vencimientos">
              <p>Ranking por saldo, estado de cobranza y antigüedad de la deuda (aging).</p>
            </ReporteInfoDialog>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['todos', 'Todos'],
              ['al_dia', 'Al día'],
              ['con_deuda', 'Con deuda'],
              ['vencido', 'Vencidos'],
              ['saldo_a_favor', 'A favor'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setEstado(key)}
              className={cn(buttonVariants({ variant: estado === key ? 'default' : 'outline', size: 'sm' }))}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {mostrarSelector ? (
        <div className="flex flex-wrap items-end gap-3">
          <ReporteFiltroSucursalSelect opciones={opciones} value={sucursalId} onChange={setSucursalId} />
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <a href={csvHref} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'inline-flex')}>
          <Download className="mr-1 h-3.5 w-3.5" />
          Exportar CSV
        </a>
        <BotonDescargarPdf disabled={!data || loading} onGenerar={generarPdf} />
      </div>

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
            <p className="text-xs text-muted-foreground">Clientes vencidos</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{data.resumen.vencidos}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Saldo a favor</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-emerald-700">
              {formatCurrency(data.resumen.saldo_a_favor_total ?? 0)}
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {data.resumen.clientes_con_saldo_a_favor ?? 0} cliente(s)
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
              <TableHead className="text-right">0-30</TableHead>
              <TableHead className="text-right">31-60</TableHead>
              <TableHead className="text-right">61+</TableHead>
              <TableHead className="text-right">Abiertas</TableHead>
              <TableHead className="text-right">Vencidas</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!data || loading ? (
              <TableRow>
                <TableCell colSpan={9} className="text-muted-foreground">
                  Cargando…
                </TableCell>
              </TableRow>
            ) : data.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-muted-foreground">
                  No hay clientes para el filtro seleccionado.
                </TableCell>
              </TableRow>
            ) : (
              data.items.map((it) => (
                <TableRow key={it.cliente_id}>
                  <TableCell className="font-medium">{it.cliente_nombre}</TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
                        it.estado === 'al_dia'
                          ? 'bg-emerald-500/15 text-emerald-700'
                          : it.estado === 'saldo_a_favor'
                            ? 'bg-sky-500/15 text-sky-700'
                          : it.estado === 'vencido'
                            ? 'bg-destructive/15 text-destructive'
                            : 'bg-amber-500/15 text-amber-700',
                      )}
                    >
                      {it.estado === 'al_dia' ? (
                        <CircleCheck className="h-3 w-3" />
                      ) : it.estado === 'saldo_a_favor' ? (
                        <CircleCheck className="h-3 w-3" />
                      ) : it.estado === 'vencido' ? (
                        <AlertTriangle className="h-3 w-3" />
                      ) : (
                        <CalendarClock className="h-3 w-3" />
                      )}
                      {estadoClienteLabel(it.estado)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(Math.abs(it.saldo_total))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(it.aging_0_30)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(it.aging_31_60)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(it.aging_61_plus)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{it.facturas_abiertas}</TableCell>
                  <TableCell className="text-right tabular-nums">{it.facturas_vencidas}</TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/clientes/${it.cliente_id}`}
                      className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'inline-flex')}
                    >
                      <Users className="mr-1 h-3.5 w-3.5" />
                      Ver cliente
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
