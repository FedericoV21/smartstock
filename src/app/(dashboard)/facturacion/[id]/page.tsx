'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Download, Printer, RefreshCw } from 'lucide-react';

import { useDashboardRole } from '@/components/dashboard/dashboard-role-context';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatearNumeroComprobante } from '@/lib/facturacion/formato';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDate } from '@/lib/utils/formatters';

const TIPO_LABELS: Record<string, string> = {
  factura_a: 'Factura A',
  factura_b: 'Factura B',
  factura_c: 'Factura C',
  nota_credito_a: 'Nota de Crédito A',
  nota_credito_b: 'Nota de Crédito B',
  nota_credito_c: 'Nota de Crédito C',
  remito: 'Remito',
  presupuesto: 'Presupuesto',
  ticket: 'Ticket',
};

const ESTADO_STYLES: Record<string, string> = {
  emitido: 'bg-emerald-100 text-emerald-800',
  borrador: 'bg-gray-100 text-gray-800',
  anulado: 'bg-red-100 text-red-800',
  pendiente_arca: 'bg-yellow-100 text-yellow-800',
  pendiente_posnet: 'bg-amber-100 text-amber-900',
  error_arca: 'bg-red-100 text-red-800',
};

type ComprobanteDetalle = {
  id: string;
  tipo: string;
  fiscalizado_por_id: string | null;
  factura_fiscal: { id: string; tipo: string; numero: number } | null;
  numero_orden: number;
  numero: number;
  fecha: string;
  subtotal: number;
  iva_monto: number;
  iva_porcentaje: number;
  total: number;
  estado: string;
  punto_de_venta: number | null;
  pdf_url: string | null;
  cae: string | null;
  cae_vencimiento: string | null;
  notas: string | null;
  cliente: {
    nombre: string;
    razon_social: string | null;
    cuit_dni: string | null;
    condicion_iva: string | null;
  } | null;
  items: {
    id: string;
    cantidad: number;
    precio_unitario: number;
    subtotal: number;
    producto: {
      nombre: string;
      codigo: string | null;
      iva_porcentaje?: number | null;
    } | null;
  }[];
};

export default function ComprobanteDetallePage() {
  const { canEdit } = useDashboardRole();
  const { id } = useParams<{ id: string }>();
  const [comprobante, setComprobante] = useState<ComprobanteDetalle | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [pdfRetrying, setPdfRetrying] = useState(false);
  const [arcaRetrying, setArcaRetrying] = useState(false);
  const [arcaRetryMessage, setArcaRetryMessage] = useState<string | null>(null);
  const [arcaRetryError, setArcaRetryError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setLoading(true);
    const res = await fetch(`/api/facturacion/${id}`);
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? 'Error al cargar');
    } else {
      setError(null);
      setComprobante(json);
    }
    if (!opts?.quiet) setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl p-6 text-sm text-muted-foreground">
        Cargando…
      </div>
    );
  }

  if (error || !comprobante) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <p className="text-sm text-destructive">{error ?? 'No encontrado'}</p>
        <Link
          href="/facturacion"
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
        >
          ← Volver
        </Link>
      </div>
    );
  }

  const c = comprobante;
  const numeroFormateado = formatearNumeroComprobante(c.punto_de_venta ?? 1, c.numero);

  const puedeReintentarArca =
    canEdit &&
    (c.estado === 'error_arca' || c.estado === 'pendiente_arca') &&
    !c.cae &&
    (c.tipo.startsWith('factura_') || c.tipo.startsWith('nota_credito_'));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/facturacion"
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
        >
          ← Volver
        </Link>
      </div>

      {c.tipo === 'ticket' && c.factura_fiscal ? (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
          <p className="font-semibold">Venta facturada (orden {c.numero_orden ?? '—'})</p>
          <p className="mt-1 text-blue-900/90">
            El comprobante fiscal de esta venta es la{' '}
            <Link
              href={`/facturacion/${c.factura_fiscal.id}`}
              className="font-medium text-primary underline"
            >
              {TIPO_LABELS[c.factura_fiscal.tipo] ?? c.factura_fiscal.tipo} #
              {String(c.factura_fiscal.numero).padStart(8, '0')}
            </Link>
            . Este ticket es el registro original de la venta.
          </p>
        </div>
      ) : null}

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            Orden de venta {c.numero_orden != null ? `#${c.numero_orden}` : '—'}
          </p>
          <h1 className="text-xl font-bold">
            {TIPO_LABELS[c.tipo] ?? c.tipo} {numeroFormateado}
          </h1>
          <p className="text-muted-foreground">{formatDate(c.fecha)}</p>
          {c.cliente ? (
            <p className="mt-1 text-sm">
              Cliente: {c.cliente.razon_social || c.cliente.nombre}
              {c.cliente.cuit_dni ? (
                <span className="ml-2 font-mono text-xs text-muted-foreground">
                  ({c.cliente.cuit_dni})
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {c.pdf_url ? (
            <>
              <a
                href={c.pdf_url}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  buttonVariants({ variant: 'outline', size: 'sm' }),
                  'gap-1',
                )}
              >
                <Download className="h-4 w-4" /> Descargar
              </a>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={() => window.open(c.pdf_url!, '_blank')}
              >
                <Printer className="h-4 w-4" /> Imprimir
              </Button>
            </>
          ) : c.estado === 'emitido' ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1"
              disabled={pdfRetrying}
              onClick={async () => {
                setPdfRetrying(true);
                try {
                  await load({ quiet: true });
                } finally {
                  setPdfRetrying(false);
                }
              }}
            >
              <Download className="h-4 w-4" />
              {pdfRetrying ? 'Generando PDF…' : 'Obtener PDF'}
            </Button>
          ) : null}
        </div>
      </div>

      {/* Estado */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2 py-1 text-xs font-medium ${ESTADO_STYLES[c.estado] ?? 'bg-gray-100 text-gray-800'}`}
        >
          {c.estado.replace('_', ' ').toUpperCase()}
        </span>
        {c.tipo === 'ticket' && c.factura_fiscal ? (
          <Link
            href={`/facturacion/${c.factura_fiscal.id}`}
            className="text-sm text-primary hover:underline"
          >
            Ir a la factura →
          </Link>
        ) : null}
      </div>

      {c.tipo === 'ticket' &&
      c.estado === 'emitido' &&
      !c.fiscalizado_por_id &&
      canEdit ? (
        <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50/80 p-4 text-sm text-amber-950">
          <p className="font-medium">Ticket no fiscal</p>
          <p className="mt-1 text-amber-900/90">
            Podés emitir la factura correspondiente sin volver a mover el stock (la venta ya se registró con este ticket).
          </p>
          <Link
            href={`/facturacion/nueva?desde_ticket=${c.id}`}
            className={cn(buttonVariants({ size: 'default' }), 'mt-3 inline-flex')}
          >
            Facturar fiscalmente
          </Link>
        </div>
      ) : null}

      {/* CAE */}
      {c.cae ? (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm">
          <p className="font-medium text-green-800">CAE: {c.cae}</p>
          {c.cae_vencimiento ? (
            <p className="text-green-700">
              Vencimiento: {formatDate(c.cae_vencimiento)}
            </p>
          ) : null}
        </div>
      ) : null}

      {puedeReintentarArca ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50/90 p-4 text-sm text-amber-950">
          <p className="font-medium">
            {c.estado === 'pendiente_arca'
              ? 'Pendiente de autorización ARCA'
              : 'ARCA no autorizó este comprobante'}
          </p>
          <p className="mt-1 text-amber-900/90">
            Corregí certificado, ambiente o datos en Configuración ARCA y volvé a solicitar el CAE.
            No se duplica el comprobante ni el número fiscal.
          </p>
          {arcaRetryError ? (
            <p className="mt-2 text-xs text-destructive">{arcaRetryError}</p>
          ) : null}
          {arcaRetryMessage ? (
            <p className="mt-2 text-xs text-emerald-800">{arcaRetryMessage}</p>
          ) : null}
          <Button
            type="button"
            variant="default"
            size="sm"
            className="mt-3 gap-1.5"
            disabled={arcaRetrying}
            onClick={async () => {
              setArcaRetryMessage(null);
              setArcaRetryError(null);
              setArcaRetrying(true);
              try {
                const res = await fetch(`/api/facturacion/${c.id}/reintentar-arca`, {
                  method: 'POST',
                });
                const json = await res.json().catch(() => ({}));
                if (!res.ok) {
                  setArcaRetryError(
                    typeof json.error === 'string' ? json.error : 'No se pudo reintentar ARCA',
                  );
                  return;
                }
                setArcaRetryMessage('CAE obtenido correctamente.');
                await load({ quiet: true });
              } finally {
                setArcaRetrying(false);
              }
            }}
          >
            <RefreshCw className={`h-4 w-4 ${arcaRetrying ? 'animate-spin' : ''}`} />
            {arcaRetrying ? 'Consultando ARCA…' : 'Reintentar autorización ARCA'}
          </Button>
        </div>
      ) : null}

      {/* Items */}
      <div className="rounded-xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Producto</TableHead>
              <TableHead className="text-right">Cantidad</TableHead>
              <TableHead className="text-right">P. Unitario</TableHead>
              {c.iva_monto > 0 && (
                <>
                  <TableHead className="text-right">IVA %</TableHead>
                  <TableHead className="text-right">IVA</TableHead>
                </>
              )}
              <TableHead className="text-right">Subtotal</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {c.items.map((item) => {
              const rate = item.producto?.iva_porcentaje ?? c.iva_porcentaje;
              const lineIva =
                c.iva_monto > 0 && rate
                  ? Math.round(((item.subtotal * rate) / (100 + rate)) * 100) / 100
                  : 0;
              return (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">
                    {item.producto?.nombre ?? '—'}
                  </TableCell>
                  <TableCell className="text-right">{item.cantidad}</TableCell>
                  <TableCell className="text-right font-mono">
                    {formatCurrency(item.precio_unitario)}
                  </TableCell>
                  {c.iva_monto > 0 && (
                    <>
                      <TableCell className="text-right font-mono text-muted-foreground">
                        {rate != null ? `${rate}%` : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">
                        {formatCurrency(lineIva)}
                      </TableCell>
                    </>
                  )}
                  <TableCell className="text-right font-mono">
                    {formatCurrency(item.subtotal)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Totales */}
      <div className="text-right space-y-1 text-sm">
        {c.iva_monto > 0 ? (
          <>
            <p>
              Neto gravado:{' '}
              <span className="font-mono">{formatCurrency(c.subtotal)}</span>
            </p>
            <p>
              IVA ({c.iva_porcentaje}%) <span className="text-xs">(incluido)</span>:{' '}
              <span className="font-mono">{formatCurrency(c.iva_monto)}</span>
            </p>
          </>
        ) : (
          <p>
            Subtotal:{' '}
            <span className="font-mono">{formatCurrency(c.subtotal)}</span>
          </p>
        )}
        <p className="text-lg font-bold">
          Total: <span className="font-mono">{formatCurrency(c.total)}</span>
        </p>
      </div>

      {/* Notas */}
      {c.notas ? (
        <div className="rounded-lg border bg-muted/30 p-3 text-sm">
          <p className="text-muted-foreground">Observaciones:</p>
          <p className="mt-1 whitespace-pre-wrap">{c.notas}</p>
        </div>
      ) : null}
    </div>
  );
}
