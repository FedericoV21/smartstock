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
  filtros?: { cliente_id: string | null };
  resumen: {
    cantidad: number;
    total_monto: number;
    promedio_monto: number;
    sin_cliente: number;
    cobros_sin_comprobante_recibo?: number;
    cobranza_sin_recibo_emitido?: number;
    pagos_cuenta_corriente_libres?: number;
  };
  items: {
    id: string;
    fecha: string;
    numero: number | null;
    total: number;
    metodo_pago: string;
    cliente_nombre: string;
    sin_comprobante_recibo?: boolean;
    origen?: 'recibo' | 'cobranza_sin_recibo' | 'cuenta_corriente';
  }[];
  error?: string;
};

export function ReporteRecibos() {
  const { hidrato, aplicarASearchParams, mostrarSelector, opciones, sucursalId, setSucursalId } =
    useReporteFiltroSucursalAdmin();
  const [periodo, setPeriodo] = useState<Periodo>('mes');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [clienteId, setClienteId] = useState('');
  const [clientes, setClientes] = useState<{ id: string; nombre: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);

  useEffect(() => {
    async function loadClientes() {
      const res = await fetch('/api/clientes');
      const json = (await res.json()) as { clientes?: { id: string; nombre: string }[]; error?: string };
      if (res.ok && Array.isArray(json.clientes)) {
        setClientes(
          [...json.clientes]
            .map((c) => ({ id: c.id, nombre: c.nombre }))
            .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
        );
      }
    }
    void loadClientes();
  }, []);

  const query = useMemo(() => {
    const qs = new URLSearchParams({ periodo });
    if (periodo === 'rango') {
      if (desde) qs.set('desde', desde);
      if (hasta) qs.set('hasta', hasta);
    }
    if (clienteId) qs.set('cliente_id', clienteId);
    aplicarASearchParams(qs);
    return qs.toString();
  }, [periodo, desde, hasta, clienteId, aplicarASearchParams]);

  useEffect(() => {
    if (!hidrato) return;
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/reportes/recibos?${query}`);
      const json = (await res.json()) as ApiResponse;
      if (!active) return;
      if (!res.ok) {
        setError(json.error ?? 'No se pudo cargar el reporte de recibos');
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

  const csvHref = `/api/reportes/recibos?${query}&export=csv`;

  function generarPdf() {
    if (!data) return;
    const p = data.periodo;
    const clienteLabel =
      clienteId && clientes.length
        ? clientes.find((c) => c.id === clienteId)?.nombre ?? clienteId
        : null;
    const filas = data.items.map((it) => [
      formatDate(it.fecha),
      it.numero != null ? String(it.numero) : '—',
      (it.cliente_nombre ?? '—').slice(0, 36),
      (it.metodo_pago ?? '—').slice(0, 16),
      formatCurrency(it.total),
    ]);
    descargarPdfTabla({
      nombreArchivo: nombrePdfReporte('recibos'),
      titulo: 'Recibos y cobros',
      lineasMeta: [
        `Período: ${p.desde} → ${p.hasta}`,
        ...(clienteLabel ? [`Cliente: ${clienteLabel}`] : []),
        `Cantidad: ${data.resumen.cantidad} · Total: ${formatCurrency(data.resumen.total_monto)} · Promedio: ${formatCurrency(data.resumen.promedio_monto)}`,
      ],
      encabezados: ['Fecha', 'Nº', 'Cliente', 'Medio', 'Monto'],
      anchosMm: [26, 16, 68, 28, 52],
      filas,
    });
  }

  return (
    <section className="space-y-4 rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-medium">Recibos y cobros</h2>
            <ReporteInfoDialog title="Recibos y cobros">
              <p>
                Incluye comprobantes recibo, cobros de factura sin recibo emitido y pagos registrados desde la cuenta
                corriente del cliente.
              </p>
              <p>
                Los pagos cargados desde Registrar pago no generan fila en cobranza por factura, por eso se muestran
                agrupados dentro de este reporte.
              </p>
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

      <div className="flex max-w-xl flex-col gap-1">
        <label className="text-xs text-muted-foreground" htmlFor="recibos-filtro-cliente">
          Cliente (opcional)
        </label>
        <select
          id="recibos-filtro-cliente"
          className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          value={clienteId}
          onChange={(e) => setClienteId(e.target.value)}
        >
          <option value="">Todos los clientes</option>
          {clientes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
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
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Cantidad</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{data.resumen.cantidad}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{formatCurrency(data.resumen.total_monto)}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Promedio</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{formatCurrency(data.resumen.promedio_monto)}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Sin cliente</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{data.resumen.sin_cliente}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Sin recibo + pagos CC</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {data.resumen.cobros_sin_comprobante_recibo ?? 0}
            </p>
            <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
              Cobranza sin recibo: {data.resumen.cobranza_sin_recibo_emitido ?? 0} · Pago libre CC:{' '}
              {data.resumen.pagos_cuenta_corriente_libres ?? 0}
            </p>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Nro.</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Medio</TableHead>
              <TableHead className="text-right">Monto</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!data || loading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  Cargando...
                </TableCell>
              </TableRow>
            ) : data.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  No hay recibos ni cobros para este período
                  {clienteId ? ' y el cliente elegido' : ''}.
                </TableCell>
              </TableRow>
            ) : (
              data.items.map((it) => (
                <TableRow key={it.id}>
                  <TableCell>{formatDate(it.fecha)}</TableCell>
                  <TableCell>
                    {it.numero != null ? (
                      <span className="tabular-nums">{it.numero}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                    {it.origen === 'cobranza_sin_recibo' ? (
                      <span className="mt-0.5 block text-[10px] font-normal text-amber-800 dark:text-amber-200">
                        Cobro de factura sin recibo emitido
                      </span>
                    ) : null}
                    {it.origen === 'cuenta_corriente' ? (
                      <span className="mt-0.5 block text-[10px] font-normal text-sky-900 dark:text-sky-200">
                        Pago desde cuenta corriente
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-medium">{it.cliente_nombre}</TableCell>
                  <TableCell>{it.metodo_pago}</TableCell>
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
