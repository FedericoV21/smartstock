'use client';

import { Download } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { BotonDescargarPdf } from '@/components/reportes/boton-descargar-pdf';
import { ReporteInfoDialog } from '@/components/reportes/reporte-info-dialog';
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
import { fetchEmisorParaPdfInforme } from '@/lib/reportes/pdf-emisor-client';
import type { ExtractoProveedorPayload } from '@/lib/proveedores/extracto-proveedor';
import { generarPdfExtractoProveedor } from '@/lib/proveedores/extracto-proveedor-pdf';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/utils/formatters';

type Periodo = 'hoy' | 'semana' | 'mes' | 'rango';

export function ReporteExtractoCuentaCorrienteProveedor() {
  const searchParams = useSearchParams();
  const proveedorInicial = searchParams.get('proveedor_id')?.trim() ?? '';

  const [periodo, setPeriodo] = useState<Periodo>('mes');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [proveedorId, setProveedorId] = useState(proveedorInicial);
  const [proveedores, setProveedores] = useState<{ id: string; nombre: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ExtractoProveedorPayload | null>(null);

  useEffect(() => {
    if (proveedorInicial) setProveedorId(proveedorInicial);
  }, [proveedorInicial]);

  useEffect(() => {
    async function loadProveedores() {
      const res = await fetch('/api/proveedores');
      const json = (await res.json()) as {
        proveedores?: { id: string; nombre: string }[];
      };
      if (res.ok && Array.isArray(json.proveedores)) {
        setProveedores(
          [...json.proveedores]
            .map((p) => ({ id: p.id, nombre: p.nombre }))
            .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
        );
      }
    }
    void loadProveedores();
  }, []);

  const query = useMemo(() => {
    const qs = new URLSearchParams({ periodo });
    if (periodo === 'rango') {
      if (desde) qs.set('desde', desde);
      if (hasta) qs.set('hasta', hasta);
    }
    if (proveedorId) qs.set('proveedor_id', proveedorId);
    return qs.toString();
  }, [periodo, desde, hasta, proveedorId]);

  useEffect(() => {
    if (!proveedorId) {
      setData(null);
      setLoading(false);
      return;
    }
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/reportes/extracto-cuenta-corriente-proveedor?${query}`);
      const json = (await res.json()) as ExtractoProveedorPayload & { error?: string };
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
  }, [query, proveedorId]);

  const csvHref = proveedorId
    ? `/api/reportes/extracto-cuenta-corriente-proveedor?${query}&export=csv`
    : null;

  async function generarPdf() {
    if (!data) return;
    const emisor = await fetchEmisorParaPdfInforme();
    generarPdfExtractoProveedor(data, emisor);
  }

  return (
    <div className="space-y-4">
      <ReporteInfoDialog title="Extracto de cuenta corriente — proveedor">
        <p>
          Movimientos que afectan la deuda con el proveedor: facturas de compra e importaciones a crédito, y pagos
          registrados. El saldo corrido se calcula desde el saldo actual del sistema.
        </p>
      </ReporteInfoDialog>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Proveedor</span>
          <select
            className="h-9 min-w-[220px] rounded-md border bg-background px-2 text-sm"
            value={proveedorId}
            onChange={(e) => setProveedorId(e.target.value)}
          >
            <option value="">Elegí un proveedor…</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
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

      {!proveedorId ? (
        <p className="text-sm text-muted-foreground">Seleccioná un proveedor para ver el extracto.</p>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {loading ? <p className="text-sm text-muted-foreground">Cargando…</p> : null}

      {data && !loading ? (
        <>
          <p className="text-sm text-muted-foreground">
            {data.proveedor_nombre} · {data.periodo.label} ({formatDate(data.periodo.desde)} –{' '}
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
