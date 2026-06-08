'use client';

import { Download } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
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
import type { ExtractoPayload } from '@/lib/cuenta-corriente/extracto';
import { generarPdfExtractoCc } from '@/lib/cuenta-corriente/extracto-pdf';
import { fetchEmisorParaPdfInforme } from '@/lib/reportes/pdf-emisor-client';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/utils/formatters';

type Periodo = 'hoy' | 'semana' | 'mes' | 'rango';

export function ReporteExtractoCuentaCorriente() {
  const searchParams = useSearchParams();
  const clienteInicial = searchParams.get('cliente_id')?.trim() ?? '';

  const { hidrato, aplicarASearchParams, mostrarSelector, opciones, sucursalId, setSucursalId } =
    useReporteFiltroSucursalAdmin();
  const [periodo, setPeriodo] = useState<Periodo>('mes');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [clienteId, setClienteId] = useState(clienteInicial);
  const [clientes, setClientes] = useState<{ id: string; nombre: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ExtractoPayload | null>(null);

  useEffect(() => {
    if (clienteInicial) setClienteId(clienteInicial);
  }, [clienteInicial]);

  useEffect(() => {
    async function loadClientes() {
      const res = await fetch('/api/clientes');
      const json = (await res.json()) as {
        clientes?: { id: string; nombre: string; razon_social?: string | null }[];
      };
      if (res.ok && Array.isArray(json.clientes)) {
        setClientes(
          [...json.clientes]
            .map((c) => ({
              id: c.id,
              nombre: String(c.razon_social || c.nombre),
            }))
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
    if (!hidrato || !clienteId) {
      setData(null);
      setLoading(false);
      return;
    }
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/reportes/extracto-cuenta-corriente?${query}`);
      const json = (await res.json()) as ExtractoPayload & { error?: string };
      if (!active) return;
      if (!res.ok) {
        setError(json.error ?? 'No se pudo cargar el extracto');
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
  }, [query, hidrato, clienteId]);

  const csvHref = clienteId
    ? `/api/reportes/extracto-cuenta-corriente?${query}&export=csv`
    : null;

  async function generarPdf() {
    if (!data) return;
    const emisor = await fetchEmisorParaPdfInforme();
    generarPdfExtractoCc(data, emisor);
  }

  return (
    <div className="space-y-4">
      <ReporteInfoDialog title="Extracto de cuenta corriente">
        <p>
          Movimientos que afectan la deuda del cliente: ventas a cuenta corriente, notas de crédito y pagos
          registrados. El saldo corrido se calcula desde el saldo actual del sistema.
        </p>
      </ReporteInfoDialog>

      <div className="flex flex-wrap items-end gap-3">
        {mostrarSelector ? (
          <ReporteFiltroSucursalSelect value={sucursalId} onChange={setSucursalId} opciones={opciones} />
        ) : null}
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Cliente</span>
          <select
            className="h-9 min-w-[220px] rounded-md border bg-background px-2 text-sm"
            value={clienteId}
            onChange={(e) => setClienteId(e.target.value)}
          >
            <option value="">Elegí un cliente…</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Período</span>
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={periodo}
            onChange={(e) => setPeriodo(e.target.value as Periodo)}
          >
            <option value="hoy">Hoy</option>
            <option value="semana">Semana</option>
            <option value="mes">Mes</option>
            <option value="rango">Rango</option>
          </select>
        </label>
        {periodo === 'rango' ? (
          <>
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">Desde</span>
              <Input type="date" className="h-9 w-36" value={desde} onChange={(e) => setDesde(e.target.value)} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">Hasta</span>
              <Input type="date" className="h-9 w-36" value={hasta} onChange={(e) => setHasta(e.target.value)} />
            </label>
          </>
        ) : null}
        {csvHref ? (
          <a
            href={csvHref}
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'inline-flex gap-1')}
          >
            <Download className="h-4 w-4" />
            CSV
          </a>
        ) : null}
        <BotonDescargarPdf disabled={!data || loading} onGenerar={generarPdf} />
      </div>

      {!clienteId ? (
        <p className="text-sm text-muted-foreground">Seleccioná un cliente para ver el extracto.</p>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {loading ? <p className="text-sm text-muted-foreground">Cargando…</p> : null}

      {data && !loading ? (
        <>
          <p className="text-sm text-muted-foreground">
            {data.cliente_nombre} · {data.periodo.label} ({formatDate(data.periodo.desde)} –{' '}
            {formatDate(data.periodo.hasta)})
          </p>
          <dl className="grid gap-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Saldo inicial</dt>
              <dd className="text-lg font-semibold tabular-nums">{data.saldo_inicial_label}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Saldo final</dt>
              <dd className="text-lg font-semibold tabular-nums">{data.saldo_final_label}</dd>
            </div>
          </dl>
          <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead className="text-right">Debe</TableHead>
                  <TableHead className="text-right">Haber</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.lineas.map((l, i) => (
                  <TableRow key={`${l.fecha}-${i}`}>
                    <TableCell>{formatDate(l.fecha)}</TableCell>
                    <TableCell>{l.descripcion}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.debe_label}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.haber_label}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{l.saldo_label}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      ) : null}
    </div>
  );
}
