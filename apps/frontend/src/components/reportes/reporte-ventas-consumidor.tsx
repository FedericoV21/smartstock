'use client';

import Link from 'next/link';
import { Download, ReceiptText } from 'lucide-react';
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
import { formatCurrency, formatDate } from '@/lib/utils/formatters';

type Periodo = 'hoy' | 'semana' | 'mes' | 'rango';
type Franja = 'hora' | 'media_jornada';

type ApiResponse = {
  periodo: { key: Periodo; desde: string; hasta: string };
  filtros: { caja_id: string | null; usuario_id: string | null; franja: Franja };
  indicadores: {
    total_tickets: number;
    total_vendido: number;
    ticket_promedio: number;
    total_ordenes: number;
  };
  distribucion: { label: string; tickets: number; total: number }[];
  detalle: {
    id: string;
    numero: number;
    numero_orden: number;
    fecha: string;
    created_at: string;
    total: number;
    caja_id: string | null;
    usuario_id: string | null;
    usuario_nombre: string | null;
    metodo_pago: string | null;
  }[];
  opciones: { cajas: { id: string; label: string }[]; usuarios: { id: string; nombre: string }[] };
  error?: string;
};

export function ReporteVentasConsumidor() {
  const { hidrato, aplicarASearchParams, mostrarSelector, opciones, sucursalId, setSucursalId } =
    useReporteFiltroSucursalAdmin();
  const [periodo, setPeriodo] = useState<Periodo>('hoy');
  const [franja, setFranja] = useState<Franja>('hora');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [cajaId, setCajaId] = useState('');
  const [usuarioId, setUsuarioId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);

  const qs = useMemo(() => {
    const p = new URLSearchParams({ periodo, franja });
    if (periodo === 'rango') {
      if (desde) p.set('desde', desde);
      if (hasta) p.set('hasta', hasta);
    }
    if (cajaId) p.set('caja_id', cajaId);
    if (usuarioId) p.set('usuario_id', usuarioId);
    aplicarASearchParams(p);
    return p.toString();
  }, [periodo, franja, desde, hasta, cajaId, usuarioId, aplicarASearchParams]);

  useEffect(() => {
    if (!hidrato) return;
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/reportes/ventas-consumidor?${qs}`);
      const json = (await res.json()) as ApiResponse;
      if (!active) return;
      if (!res.ok) {
        setError(json.error ?? 'No se pudo cargar reporte de ventas consumidor final');
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

  const csvHref = `/api/reportes/ventas-consumidor?${qs}&export=csv`;

  function generarPdf() {
    if (!data) return;
    const p = data.periodo;
    const filas = data.detalle.map((t) => [
      formatDate(t.fecha),
      String(t.numero),
      String(t.numero_orden),
      (t.caja_id ?? '—').slice(0, 12),
      (t.usuario_nombre ?? t.usuario_id ?? '—').slice(0, 22),
      (t.metodo_pago ?? '—').slice(0, 14),
      formatCurrency(t.total),
    ]);
    descargarPdfTabla({
      nombreArchivo: nombrePdfReporte('ventas-pos-tickets'),
      titulo: 'Ventas POS (tickets)',
      lineasMeta: [
        `Período: ${p.desde} → ${p.hasta}`,
        `Tickets: ${data.indicadores.total_tickets} · Vendido: ${formatCurrency(data.indicadores.total_vendido)} · Ticket prom.: ${formatCurrency(data.indicadores.ticket_promedio)}`,
      ],
      encabezados: ['Fecha', 'Nº ticket', 'Nº orden', 'Caja', 'Operador', 'Pago', 'Total'],
      anchosMm: [24, 16, 16, 26, 44, 26, 38],
      filas,
    });
  }

  return (
    <section className="space-y-4 rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-medium">Ventas POS (tickets)</h2>
            <ReporteInfoDialog title="Ventas POS (tickets)">
              <p>Tickets por período, distribución por franja y detalle por caja u operador.</p>
              <p>
                Para analizar unidades, margen y stock por producto usá{' '}
                <Link href="/reportes/ventas-articulo" className="font-medium text-primary underline-offset-4 hover:underline">
                  Ventas por artículo
                </Link>
                .
              </p>
              <p>Este reporte se basa en comprobantes tipo ticket emitidos por POS.</p>
              <p>Los filtros por caja y usuario dependen de los datos cargados en cada comprobante.</p>
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
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={cn(buttonVariants({ variant: franja === 'hora' ? 'default' : 'outline', size: 'sm' }))}
          onClick={() => setFranja('hora')}
        >
          Por hora
        </button>
        <button
          type="button"
          className={cn(
            buttonVariants({ variant: franja === 'media_jornada' ? 'default' : 'outline', size: 'sm' }),
          )}
          onClick={() => setFranja('media_jornada')}
        >
          Media jornada
        </button>
        {periodo === 'rango' ? (
          <>
            <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="w-40" />
            <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="w-40" />
          </>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <select
          value={cajaId}
          onChange={(e) => setCajaId(e.target.value)}
          className="h-9 min-w-[200px] rounded-md border border-input bg-transparent px-3 text-sm"
        >
          <option value="">Todas las cajas</option>
          {(data?.opciones.cajas ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <select
          value={usuarioId}
          onChange={(e) => setUsuarioId(e.target.value)}
          className="h-9 min-w-[220px] rounded-md border border-input bg-transparent px-3 text-sm"
        >
          <option value="">Todos los usuarios</option>
          {(data?.opciones.usuarios ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.nombre}
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
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Total tickets</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{data.indicadores.total_tickets}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Total vendido</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {formatCurrency(data.indicadores.total_vendido)}
            </p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Ticket promedio</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {formatCurrency(data.indicadores.ticket_promedio)}
            </p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Órdenes (numero_orden)</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{data.indicadores.total_ordenes}</p>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Franja</TableHead>
              <TableHead className="text-right">Tickets</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!data || loading ? (
              <TableRow>
                <TableCell colSpan={3} className="text-muted-foreground">
                  Cargando…
                </TableCell>
              </TableRow>
            ) : data.distribucion.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-muted-foreground">
                  Sin movimientos para el rango seleccionado.
                </TableCell>
              </TableRow>
            ) : (
              data.distribucion.map((d) => (
                <TableRow key={d.label}>
                  <TableCell>{d.label}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.tickets}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(d.total)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>N° ticket</TableHead>
              <TableHead>N° orden</TableHead>
              <TableHead>Caja</TableHead>
              <TableHead>Usuario</TableHead>
              <TableHead>Método pago</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!data || loading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-muted-foreground">
                  Cargando…
                </TableCell>
              </TableRow>
            ) : data.detalle.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-muted-foreground">
                  Sin tickets para los filtros aplicados.
                </TableCell>
              </TableRow>
            ) : (
              data.detalle.slice(0, 120).map((it) => (
                <TableRow key={it.id}>
                  <TableCell>{formatDate(it.fecha)}</TableCell>
                  <TableCell className="tabular-nums">{it.numero}</TableCell>
                  <TableCell className="tabular-nums">{it.numero_orden}</TableCell>
                  <TableCell>{it.caja_id ?? '—'}</TableCell>
                  <TableCell>{it.usuario_nombre ?? it.usuario_id ?? '—'}</TableCell>
                  <TableCell>{it.metodo_pago ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(it.total)}</TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/facturacion/${it.id}`}
                      className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'inline-flex')}
                    >
                      <ReceiptText className="mr-1 h-3.5 w-3.5" />
                      Ver
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
