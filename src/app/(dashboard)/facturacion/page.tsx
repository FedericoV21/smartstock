'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { useDashboardRole } from '@/components/dashboard/dashboard-role-context';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCurrency, formatDate } from '@/lib/utils/formatters';

const TIPO_LABELS: Record<string, string> = {
  factura_a: 'Factura A',
  factura_b: 'Factura B',
  factura_c: 'Factura C',
  nota_credito_a: 'NC A',
  nota_credito_b: 'NC B',
  nota_credito_c: 'NC C',
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

type Comprobante = {
  id: string;
  tipo: string;
  numero: number;
  numero_orden: number;
  fecha: string;
  subtotal: number;
  iva_monto: number;
  total: number;
  estado: string;
  fiscalizado_por_id: string | null;
  factura_fiscal: { id: string; tipo: string; numero: number } | null;
  cliente: { nombre: string; razon_social: string | null } | null;
};

function filaDocumento(c: Comprobante): {
  href: string;
  titulo: string;
  numeroFmt: string;
  subtitulo: string | null;
} {
  if (c.tipo === 'ticket' && c.factura_fiscal) {
    const f = c.factura_fiscal;
    return {
      href: `/facturacion/${f.id}`,
      titulo: TIPO_LABELS[f.tipo] ?? f.tipo,
      numeroFmt: String(f.numero).padStart(8, '0'),
      subtitulo: `Orden ${c.numero_orden} · ticket #${String(c.numero).padStart(8, '0')}`,
    };
  }
  return {
    href: `/facturacion/${c.id}`,
    titulo: TIPO_LABELS[c.tipo] ?? c.tipo,
    numeroFmt: String(c.numero).padStart(8, '0'),
    subtitulo: null,
  };
}

export default function FacturacionPage() {
  const { canEdit } = useDashboardRole();
  const [comprobantes, setComprobantes] = useState<Comprobante[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [filtroTipo, setFiltroTipo] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('');

  const load = useCallback(
    async (pag = 1) => {
      setLoading(true);
      const params = new URLSearchParams({ pagina: String(pag), por_pagina: '25' });
      if (filtroTipo) params.set('tipo', filtroTipo);
      if (filtroEstado) params.set('estado', filtroEstado);

      const res = await fetch(`/api/facturacion?${params}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Error al cargar');
        setComprobantes([]);
      } else {
        setError(null);
        setComprobantes(json.comprobantes ?? []);
        setTotal(json.total ?? 0);
        setPagina(pag);
      }
      setLoading(false);
    },
    [filtroTipo, filtroEstado],
  );

  useEffect(() => {
    void load(1);
  }, [load]);

  const totalPaginas = Math.ceil(total / 25);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Facturación</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Cada venta tiene un número de orden interno. Los tickets pasan a mostrarse como factura
            fiscal una vez fiscalizados (misma orden de venta).
          </p>
        </div>
        {canEdit ? (
          <Link href="/facturacion/nueva">
            <Button type="button" className="shrink-0">
              Emitir comprobante
            </Button>
          </Link>
        ) : null}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3">
        <select
          value={filtroTipo}
          onChange={(e) => setFiltroTipo(e.target.value)}
          className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="">Todos los tipos</option>
          {Object.entries(TIPO_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={filtroEstado}
          onChange={(e) => setFiltroEstado(e.target.value)}
          className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="">Todos los estados</option>
          <option value="emitido">Emitido</option>
          <option value="borrador">Borrador</option>
          <option value="anulado">Anulado</option>
        </select>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="rounded-xl border bg-card shadow-sm">
        {loading ? (
          <p className="p-6 text-sm text-muted-foreground">Cargando…</p>
        ) : comprobantes.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">
            No hay comprobantes emitidos.
          </p>
        ) : (
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Orden</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="w-36">Estado</TableHead>
                {canEdit ? <TableHead className="w-44 text-right">Acciones</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {comprobantes.map((c) => {
                const doc = filaDocumento(c);
                return (
                <TableRow key={c.id}>
                  <TableCell className="font-mono text-sm text-muted-foreground">
                    {c.numero_orden ?? '—'}
                  </TableCell>
                  <TableCell>
                    <Link href={doc.href} className="font-medium hover:underline block">
                      {doc.titulo}{' '}
                      <span className="font-mono text-xs">#{doc.numeroFmt}</span>
                    </Link>
                    {doc.subtitulo ? (
                      <span className="text-xs text-muted-foreground">{doc.subtitulo}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(c.fecha)}
                  </TableCell>
                  <TableCell>
                    {c.cliente
                      ? c.cliente.razon_social || c.cliente.nombre
                      : '—'}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatCurrency(c.total)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      {c.tipo === 'ticket' && c.fiscalizado_por_id ? (
                        <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-900">
                          FACTURADO
                        </span>
                      ) : null}
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO_STYLES[c.estado] ?? 'bg-gray-100 text-gray-800'}`}
                      >
                        {c.estado.replace('_', ' ').toUpperCase()}
                      </span>
                    </div>
                  </TableCell>
                  {canEdit ? (
                    <TableCell className="text-right">
                      {c.tipo === 'ticket' &&
                      c.estado === 'emitido' &&
                      !c.fiscalizado_por_id ? (
                        <Link
                          href={`/facturacion/nueva?desde_ticket=${c.id}`}
                          className="text-sm font-medium text-primary hover:underline"
                        >
                          Facturar fiscalmente
                        </Link>
                      ) : c.tipo === 'ticket' && c.fiscalizado_por_id ? (
                        <Link
                          href={`/facturacion/${c.fiscalizado_por_id}`}
                          className="text-xs text-muted-foreground hover:underline"
                        >
                          Abrir factura
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  ) : null}
                </TableRow>
              );
              })}
            </TableBody>
          </Table>
          </div>
        )}
      </div>

      {/* Paginación */}
      {totalPaginas > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <p className="text-muted-foreground">
            Página {pagina} de {totalPaginas} ({total} comprobantes)
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pagina <= 1}
              onClick={() => void load(pagina - 1)}
            >
              Anterior
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pagina >= totalPaginas}
              onClick={() => void load(pagina + 1)}
            >
              Siguiente
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
