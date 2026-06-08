'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button, buttonVariants } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

type CategoriaFiltro = 'todas' | 'factura' | 'ticket' | 'recibo';

type Item = {
  id: string;
  tipo: string;
  tipoLabel: string;
  numeroLabel: string;
  fechaLabel: string;
  estado: string;
  estadoCobro?: 'pendiente' | 'parcial' | 'pagada' | null;
  totalLabel: string;
  pdf_url: string | null;
  categoria: 'factura' | 'ticket' | 'recibo';
};

const ESTADO_LABEL: Record<string, string> = {
  emitido: 'Emitido',
  pendiente_arca: 'Pendiente ARCA',
  pendiente_posnet: 'Pendiente POS',
  pendiente_qr: 'Pendiente QR',
  pendiente_transferencia_mp: 'Pendiente Transferencia MP',
  error_arca: 'Error ARCA',
  anulado: 'Anulado',
};

const ESTADO_COBRO_LABEL: Record<'pendiente' | 'parcial' | 'pagada', string> = {
  pendiente: 'Pendiente de pago',
  parcial: 'Pago parcial',
  pagada: 'Pagada',
};

export function ClienteComprobantesHistorial({ clienteId }: { clienteId: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<CategoriaFiltro>('todas');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/clientes/${clienteId}/comprobantes`);
    const json = (await res.json()) as { items?: Item[]; error?: string };
    if (!res.ok) {
      setError(json.error ?? 'Error al cargar');
      setItems([]);
    } else {
      setItems(json.items ?? []);
    }
    setLoading(false);
  }, [clienteId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtrados = useMemo(() => {
    if (filtro === 'todas') return items;
    return items.filter((i) => i.categoria === filtro);
  }, [items, filtro]);

  const sectionClass =
    'scroll-mt-24 rounded-xl border bg-card p-5 shadow-sm';

  if (loading) {
    return (
      <section id="historial-comprobantes" className={sectionClass}>
        <h2 className="mb-2 font-medium">Historial de comprobantes</h2>
        <p className="text-sm text-muted-foreground">Cargando…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section id="historial-comprobantes" className={sectionClass}>
        <h2 className="mb-2 font-medium">Historial de comprobantes</h2>
        <p className="text-sm text-destructive">{error}</p>
      </section>
    );
  }

  if (items.length === 0) {
    return (
      <section id="historial-comprobantes" className={sectionClass}>
        <h2 className="mb-2 font-medium">Historial de comprobantes</h2>
        <p className="text-sm text-muted-foreground">
          Todavía no hay facturas, tickets ni recibos asociados a este cliente.
        </p>
      </section>
    );
  }

  return (
    <section id="historial-comprobantes" className={sectionClass}>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-medium">Historial de comprobantes</h2>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['todas', 'Todas'],
              ['factura', 'Facturas'],
              ['ticket', 'Tickets'],
              ['recibo', 'Recibos'],
            ] as const
          ).map(([key, label]) => (
            <Button
              key={key}
              type="button"
              variant={filtro === key ? 'default' : 'outline'}
              size="sm"
              className="h-8"
              onClick={() => setFiltro(key)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Comprobante</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="w-[1%] text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtrados.map((it) => (
              <TableRow key={it.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {it.fechaLabel}
                </TableCell>
                <TableCell>
                  <span className="font-medium">{it.tipoLabel}</span>{' '}
                  <span className="text-muted-foreground">{it.numeroLabel}</span>
                </TableCell>
                <TableCell>
                  {(it.categoria === 'factura' || it.categoria === 'ticket') && it.estadoCobro ? (
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs',
                        it.estadoCobro === 'pagada'
                          ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-200'
                          : it.estadoCobro === 'parcial'
                            ? 'bg-amber-500/15 text-amber-800 dark:text-amber-200'
                            : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {ESTADO_COBRO_LABEL[it.estadoCobro]}
                    </span>
                  ) : null}
                  {(it.categoria === 'factura' || it.categoria === 'ticket') && it.estadoCobro ? (
                    <span className="mx-1 text-muted-foreground">·</span>
                  ) : null}
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-xs',
                      it.estado === 'emitido'
                        ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-200'
                        : it.estado === 'anulado' || it.estado === 'error_arca'
                          ? 'bg-destructive/15 text-destructive'
                          : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {ESTADO_LABEL[it.estado] ?? it.estado}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{it.totalLabel}</TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <Link
                    href={`/facturacion/${it.id}`}
                    className={cn(buttonVariants({ variant: 'link', size: 'sm' }), 'h-auto p-0 text-xs')}
                  >
                    Ver
                  </Link>
                  {it.pdf_url ? (
                    <>
                      {' · '}
                      <a
                        href={it.pdf_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary underline-offset-4 hover:underline"
                      >
                        PDF
                      </a>
                    </>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
