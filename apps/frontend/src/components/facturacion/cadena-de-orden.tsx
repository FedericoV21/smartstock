'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { formatDate } from '@/lib/utils/formatters';

type DocumentoOrden = {
  id: string;
  tipo: string;
  numero: number | null;
  numero_formateado: string;
  fecha: string;
  estado: string;
  total: number;
  url_detalle: string;
};

type CadenaResponse = {
  numero_orden: number;
  documentos: DocumentoOrden[];
};

const TIPO_LABEL: Record<string, string> = {
  factura_a: 'Factura A',
  factura_b: 'Factura B',
  factura_c: 'Factura C',
  nota_credito_a: 'Nota de Crédito A',
  nota_credito_b: 'Nota de Crédito B',
  nota_credito_c: 'Nota de Crédito C',
  ticket: 'Ticket',
  presupuesto: 'Presupuesto',
  remito: 'Remito',
  devolucion_remito: 'Devolución de remito',
  recibo: 'Recibo',
  pedido: 'Pedido',
};

const ESTADO_LABEL: Record<string, string> = {
  emitido: 'emitido',
  borrador: 'borrador',
  anulado: 'anulado',
  confirmado: 'confirmado',
  entregado: 'entregado',
  cancelado: 'cancelado',
  importado: 'importado',
  pendiente_transferencia_mp: 'pendiente Transferencia MP',
};

export function CadenaDeOrden({
  numeroOrden,
  documentoActualId,
}: {
  numeroOrden: number | null | undefined;
  documentoActualId: string;
}) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<CadenaResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let abort = false;
    async function run() {
      if (numeroOrden == null) {
        setLoading(false);
        return;
      }
      try {
        const res = await fetch(`/api/ordenes/${numeroOrden}`);
        if (!res.ok) {
          if (!abort) setError('No se pudo cargar la cadena de la orden.');
          return;
        }
        const json = (await res.json()) as CadenaResponse;
        if (!abort) setData(json);
      } catch {
        if (!abort) setError('No se pudo cargar la cadena de la orden.');
      } finally {
        if (!abort) setLoading(false);
      }
    }
    void run();
    return () => {
      abort = true;
    };
  }, [numeroOrden]);

  if (numeroOrden == null) return null;
  if (loading) {
    return (
      <div
        data-testid="cadena-orden-loading"
        className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground"
      >
        Cargando cadena de la orden…
      </div>
    );
  }
  if (error || !data) return null;

  const docs = data.documentos ?? [];
  if (docs.length <= 1) return null;

  return (
    <div
      data-testid="cadena-orden"
      className="rounded-lg border bg-card p-4 text-sm shadow-sm"
    >
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Orden #{data.numero_orden}
      </p>
      <ul className="space-y-1">
        {docs.map((doc) => {
          const esActual = doc.id === documentoActualId;
          const label = TIPO_LABEL[doc.tipo] ?? doc.tipo;
          const estadoLabel = ESTADO_LABEL[doc.estado] ?? doc.estado;
          const extra = doc.estado && doc.estado !== 'emitido' ? ` (${estadoLabel})` : '';
          const texto = (
            <>
              <span className="font-medium">{label}</span>{' '}
              <span className="font-mono">{doc.numero_formateado}</span>{' '}
              <span className="text-muted-foreground">— {formatDate(doc.fecha)}</span>
              {extra ? <span className="text-muted-foreground">{extra}</span> : null}
            </>
          );
          return (
            <li key={doc.id} className="flex items-center gap-2">
              <span className="text-muted-foreground">•</span>
              {esActual ? (
                <span
                  data-testid="cadena-orden-actual"
                  className="flex-1 font-semibold text-foreground"
                >
                  {texto}{' '}
                  <span className="ml-1 text-xs font-normal text-primary">← estás acá</span>
                </span>
              ) : (
                <Link
                  href={doc.url_detalle}
                  className="flex-1 text-primary hover:underline"
                >
                  {texto}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
