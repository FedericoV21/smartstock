'use client';

import Link from 'next/link';
import { Download } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { BotonDescargarPdf } from '@/components/reportes/boton-descargar-pdf';
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

export function ProveedorExtractoPanel({ proveedorId }: { proveedorId: string }) {
  const [periodo, setPeriodo] = useState<Periodo>('mes');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ExtractoProveedorPayload | null>(null);

  const query = useMemo(() => {
    const qs = new URLSearchParams({ periodo });
    if (periodo === 'rango') {
      if (desde) qs.set('desde', desde);
      if (hasta) qs.set('hasta', hasta);
    }
    return qs.toString();
  }, [periodo, desde, hasta]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch(
      `/api/proveedores/${encodeURIComponent(proveedorId)}/cuenta-corriente/extracto?${query}`,
      { cache: 'no-store' },
    );
    if (!res.ok) {
      const json = (await res.json()) as { error?: string };
      setError(json.error ?? 'No se pudo cargar el extracto.');
      setData(null);
    } else {
      setData((await res.json()) as ExtractoProveedorPayload);
    }
    setLoading(false);
  }, [proveedorId, query]);

  useEffect(() => {
    void load();
  }, [load]);

  const csvHref = `/api/proveedores/${encodeURIComponent(proveedorId)}/cuenta-corriente/extracto?${query}&export=csv`;

  async function generarPdf() {
    if (!data) return;
    const emisor = await fetchEmisorParaPdfInforme();
    generarPdfExtractoProveedor(data, emisor);
  }

  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm" id="extracto-cc-proveedor">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">Extracto de cuenta corriente</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Facturas de compra y pagos del período con saldo corrido.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={csvHref}
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'inline-flex gap-1')}
          >
            <Download className="h-4 w-4" />
            CSV
          </a>
          <BotonDescargarPdf disabled={!data || loading} onGenerar={generarPdf} />
          <Link
            href={`/reportes/extracto-cuenta-corriente-proveedor?proveedor_id=${encodeURIComponent(proveedorId)}&${query}`}
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
          >
            Pantalla completa
          </Link>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
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
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {loading && !data ? (
        <p className="text-sm text-muted-foreground">Cargando extracto…</p>
      ) : null}

      {data && !loading ? (
        <>
          <dl className="mb-4 grid gap-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Saldo inicial ({data.periodo.label})</dt>
              <dd className="text-lg font-semibold tabular-nums">{data.saldo_inicial_label}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Saldo actual (final)</dt>
              <dd className="text-lg font-semibold tabular-nums">{data.saldo_final_label}</dd>
            </div>
          </dl>

          {data.lineas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin movimientos en el período.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
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
                    <TableRow key={`${l.fecha}-${l.tipo}-${i}`}>
                      <TableCell className="whitespace-nowrap">{formatDate(l.fecha)}</TableCell>
                      <TableCell>{l.descripcion}</TableCell>
                      <TableCell className="text-right tabular-nums text-red-600">{l.debe_label}</TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-600">{l.haber_label}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{l.saldo_label}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
