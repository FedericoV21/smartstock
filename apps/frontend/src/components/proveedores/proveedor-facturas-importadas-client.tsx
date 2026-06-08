'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { describirSaldoCuentaCorriente } from '@/lib/cuenta-corriente/saldo';
import { formatearTipoComprobante } from '@/lib/facturacion/formato';
import type {
  FacturaImportadaProveedor,
  FacturasImportadasPaginaResult,
} from '@/lib/proveedores/facturas-importadas-query';
import { cn } from '@/lib/utils';
import { formatCurrency, formatFechaArgDesdeApi } from '@/lib/utils/formatters';

const money = (n: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n);

const ORIGEN_IMPORTACION_LABEL: Record<NonNullable<FacturaImportadaProveedor['origen_importacion']>, string> = {
  lector: 'Lector',
  manual: 'Manual',
};

function numeroFacturaImportadaLabel(factura: FacturaImportadaProveedor): string {
  if (factura.numero != null && Number.isFinite(Number(factura.numero))) {
    return `#${String(Number(factura.numero)).padStart(8, '0')}`;
  }
  if (factura.numero_orden != null && Number.isFinite(Number(factura.numero_orden))) {
    return `ord.${factura.numero_orden}`;
  }
  return '—';
}

function estadoFacturaImportadaLabel(factura: FacturaImportadaProveedor): string {
  if (factura.estado_aplicacion === 'revertida') return 'Revertida';
  if (factura.estado === 'anulado') return 'Anulada';
  if (factura.estado === 'importado') return 'Importada';
  return factura.estado.replace('_', ' ');
}

function estadoFacturaImportadaClass(factura: FacturaImportadaProveedor): string {
  if (factura.estado_aplicacion === 'revertida' || factura.estado === 'anulado') {
    return 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-100';
  }
  if (factura.estado === 'importado') {
    return 'bg-sky-100 text-sky-900 dark:bg-sky-950/40 dark:text-sky-100';
  }
  return 'bg-muted text-muted-foreground';
}

function esNotaCreditoImportada(tipo: FacturaImportadaProveedor['tipo']): boolean {
  return typeof tipo === 'string' && tipo.startsWith('nota_credito');
}

function montoImportadoConSigno(factura: FacturaImportadaProveedor): number {
  const abs = Math.abs(factura.total);
  return esNotaCreditoImportada(factura.tipo) ? -abs : abs;
}

function importacionVigente(factura: FacturaImportadaProveedor): boolean {
  return factura.estado_aplicacion !== 'revertida' && factura.estado !== 'anulado';
}

export function ProveedorFacturasImportadasClient({
  proveedorId,
  inicial,
  saldoCuenta,
  totalUltimosPagos,
  cantidadUltimosPagos,
}: {
  proveedorId: string;
  inicial: FacturasImportadasPaginaResult;
  saldoCuenta: number;
  totalUltimosPagos: number;
  cantidadUltimosPagos: number;
}) {
  const [datos, setDatos] = useState(inicial);
  const [paginaActual, setPaginaActual] = useState(inicial.pagina);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const saldoCuentaInfo = useMemo(
    () => describirSaldoCuentaCorriente(saldoCuenta, 'proveedor'),
    [saldoCuenta],
  );

  const revertidasEnPagina = useMemo(() => {
    let n = 0;
    for (const factura of datos.facturas) {
      if (!importacionVigente(factura)) n += 1;
    }
    return n;
  }, [datos.facturas]);

  const cargarPagina = useCallback(
    (pagina: number) => {
      if (pagina < 1 || pagina > datos.totalPaginas || pagina === paginaActual) return;

      startTransition(async () => {
        setError(null);
        try {
          const res = await fetch(
            `/api/proveedores/${proveedorId}/facturas-importadas?pagina=${pagina}`,
            { cache: 'no-store' },
          );
          const json = (await res.json()) as FacturasImportadasPaginaResult & { error?: string };
          if (!res.ok) {
            setError(json.error ?? 'No se pudo cargar la página');
            return;
          }
          setDatos(json);
          setPaginaActual(json.pagina);
        } catch {
          setError('Error de conexión al cambiar de página');
        }
      });
    },
    [proveedorId, datos.totalPaginas, paginaActual],
  );

  if (datos.total === 0) {
    return (
      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="font-medium">Facturas importadas</h2>
        <p className="mt-4 text-sm text-muted-foreground">
          Todavia no hay facturas importadas para este proveedor.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">Facturas importadas</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Documentos de compra registrados para este proveedor ({datos.porPagina} por página).
          </p>
        </div>
        <span className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
          {datos.total} total
        </span>
      </div>

      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}

      <div
        className={cn(
          'mt-4 overflow-x-auto rounded-lg border border-border transition-opacity',
          isPending && 'pointer-events-none opacity-50',
        )}
        aria-busy={isPending}
      >
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Documento</TableHead>
              <TableHead>Fecha</TableHead>
              <TableHead>Origen</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {datos.facturas.map((factura) => (
              <TableRow key={factura.id}>
                <TableCell>
                  <Link href={`/facturacion/${factura.id}`} className="font-medium hover:underline">
                    {formatearTipoComprobante(factura.tipo)} {numeroFacturaImportadaLabel(factura)}
                  </Link>
                  {factura.numero_orden != null ? (
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      Orden {factura.numero_orden}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                  {formatFechaArgDesdeApi(factura.fecha)}
                </TableCell>
                <TableCell>
                  {factura.origen_importacion
                    ? ORIGEN_IMPORTACION_LABEL[factura.origen_importacion]
                    : 'Importada'}
                </TableCell>
                <TableCell>
                  <span
                    className={cn(
                      'inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize',
                      estadoFacturaImportadaClass(factura),
                    )}
                  >
                    {estadoFacturaImportadaLabel(factura)}
                  </span>
                </TableCell>
                <TableCell
                  className={cn(
                    'text-right font-medium tabular-nums',
                    esNotaCreditoImportada(factura.tipo) ? 'text-emerald-600 dark:text-emerald-400' : '',
                    !importacionVigente(factura) ? 'text-muted-foreground line-through' : '',
                  )}
                >
                  {formatCurrency(montoImportadoConSigno(factura))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            {totalUltimosPagos > 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4} className="text-muted-foreground">
                  Pagos recientes en esta pantalla
                  <span className="ml-1.5 text-xs">(últ. {cantidadUltimosPagos})</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{money(totalUltimosPagos)}</TableCell>
              </TableRow>
            ) : null}
            <TableRow className="hover:bg-transparent border-t border-border">
              <TableCell colSpan={4} className="font-semibold text-foreground">
                {saldoCuentaInfo.estado === 'deuda' ? (
                  <span className="text-red-700 dark:text-red-300">Pendiente de pago</span>
                ) : saldoCuentaInfo.estado === 'saldo_a_favor' ? (
                  <span className="text-emerald-700 dark:text-emerald-300">Saldo a favor</span>
                ) : (
                  'Sin saldo pendiente'
                )}
              </TableCell>
              <TableCell
                className={cn(
                  'text-right text-base font-bold tabular-nums',
                  saldoCuentaInfo.estado === 'deuda'
                    ? 'text-red-600 dark:text-red-400'
                    : saldoCuentaInfo.estado === 'saldo_a_favor'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : '',
                )}
              >
                {money(saldoCuentaInfo.monto)}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>

      {datos.totalPaginas > 1 ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={paginaActual <= 1 || isPending}
            onClick={() => cargarPagina(paginaActual - 1)}
          >
            Anterior
          </Button>
          <span className="text-muted-foreground">
            Página {paginaActual} de {datos.totalPaginas} · {datos.total}{' '}
            {datos.total === 1 ? 'documento' : 'documentos'}
            {isPending ? ' · Cargando…' : ''}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={paginaActual >= datos.totalPaginas || isPending}
            onClick={() => cargarPagina(paginaActual + 1)}
          >
            Siguiente
          </Button>
        </div>
      ) : null}

      <p className="mt-2 text-xs text-muted-foreground">
        El pendiente de pago refleja la cuenta corriente del proveedor (todas las compras y pagos registrados).
        {totalUltimosPagos > 0
          ? ' La fila de pagos recientes es solo referencia de los últimos movimientos visibles en esta pantalla.'
          : ''}
        {revertidasEnPagina > 0
          ? ` En esta página hay ${revertidasEnPagina} documento${revertidasEnPagina === 1 ? '' : 's'} revertido${
              revertidasEnPagina === 1 ? '' : 's'
            } o anulado${revertidasEnPagina === 1 ? '' : 's'}.`
          : ''}
      </p>
    </section>
  );
}
