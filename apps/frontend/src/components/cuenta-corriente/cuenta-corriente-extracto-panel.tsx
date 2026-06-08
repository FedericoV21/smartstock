'use client';

import Link from 'next/link';
import { Download, Pencil } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { BotonDescargarPdf } from '@/components/reportes/boton-descargar-pdf';
import { ReporteFiltroSucursalSelect, useReporteFiltroSucursalAdmin } from '@/components/reportes/use-reporte-filtro-sucursal-admin';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ExtractoLineaEditDialog } from '@/components/cuenta-corriente/extracto-linea-edit-dialog';
import { generarPdfExtractoCc } from '@/lib/cuenta-corriente/extracto-pdf';
import type { ExtractoPayloadConEdicion } from '@/lib/cuenta-corriente/fetch-extracto-data';
import type { ExtractoLineaConEdicion } from '@/lib/cuenta-corriente/extracto-editabilidad';
import { fetchEmisorParaPdfInforme } from '@/lib/reportes/pdf-emisor-client';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/utils/formatters';

type Periodo = 'hoy' | 'semana' | 'mes' | 'rango';

export function CuentaCorrienteExtractoPanel({
  clienteId,
  refreshKey = 0,
  onDatosActualizados,
}: {
  clienteId: string;
  refreshKey?: number;
  onDatosActualizados?: () => void;
}) {
  const { hidrato, aplicarASearchParams, mostrarSelector, opciones, sucursalId, setSucursalId } =
    useReporteFiltroSucursalAdmin();
  const [periodo, setPeriodo] = useState<Periodo>('mes');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ExtractoPayloadConEdicion | null>(null);
  const [lineaEdit, setLineaEdit] = useState<ExtractoLineaConEdicion | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const query = useMemo(() => {
    const qs = new URLSearchParams({ periodo });
    if (periodo === 'rango') {
      if (desde) qs.set('desde', desde);
      if (hasta) qs.set('hasta', hasta);
    }
    aplicarASearchParams(qs);
    return qs.toString();
  }, [periodo, desde, hasta, aplicarASearchParams]);

  const load = useCallback(async () => {
    if (!hidrato) return;
    setLoading(true);
    setError(null);
    const res = await fetch(
      `/api/clientes/${encodeURIComponent(clienteId)}/cuenta-corriente/extracto?${query}`,
      { cache: 'no-store' },
    );
    if (!res.ok) {
      const json = (await res.json()) as { error?: string };
      setError(json.error ?? 'No se pudo cargar el extracto.');
      setData(null);
    } else {
      setData((await res.json()) as ExtractoPayloadConEdicion);
    }
    setLoading(false);
  }, [clienteId, query, hidrato]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const hayEdicion = data?.lineas.some((l) => l.editable) ?? false;

  const csvHref = `/api/clientes/${encodeURIComponent(clienteId)}/cuenta-corriente/extracto?${query}&export=csv`;

  async function generarPdf() {
    if (!data) return;
    const emisor = await fetchEmisorParaPdfInforme();
    generarPdfExtractoCc(data, emisor);
  }

  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm" id="extracto-cc">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">Extracto de cuenta corriente</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Cargos (ventas a CC), notas de crédito y pagos del período con saldo corrido.
            {hayEdicion ? ' Podés editar filas con el ícono de lápiz.' : null}
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
            href={`/reportes/extracto-cuenta-corriente?cliente_id=${encodeURIComponent(clienteId)}&${query}`}
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
          >
            Pantalla completa
          </Link>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        {mostrarSelector ? (
          <ReporteFiltroSucursalSelect
            value={sucursalId}
            onChange={setSucursalId}
            opciones={opciones}
          />
        ) : null}
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
        <Button type="button" variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
          Actualizar
        </Button>
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
                    {hayEdicion ? <TableHead className="w-10" /> : null}
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
                      {hayEdicion ? (
                        <TableCell className="text-right">
                          {l.editable ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              title="Editar movimiento"
                              onClick={() => {
                                setLineaEdit(l);
                                setDialogOpen(true);
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          ) : l.editable_motivo ? (
                            <span
                              className="text-xs text-muted-foreground"
                              title={l.editable_motivo}
                            >
                              —
                            </span>
                          ) : null}
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      ) : null}

      <ExtractoLineaEditDialog
        clienteId={clienteId}
        linea={lineaEdit}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onGuardado={() => {
          onDatosActualizados?.();
          void load();
        }}
      />
    </section>
  );
}
