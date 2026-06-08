'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

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
import { formatearTipoComprobante } from '@/lib/facturacion/formato';
import { determinarTipoFactura, normalizarCondicionIVA } from '@/lib/facturacion/tipo-comprobante';
import { useModulos } from '@/hooks/useModulos';
import { fetchEffectivePosPrefsOnly } from '@/lib/pos/fetch-pos-prefs';
import { normalizePosPrefs } from '@/lib/pos/prefs';
import { formatCurrency, formatDate } from '@/lib/utils/formatters';
import { cn } from '@/lib/utils';

type PresupuestoConversiones = {
  ticket_id: string | null;
  ticket_numero: number | null;
  factura_id: string | null;
  factura_tipo: string | null;
  factura_numero: number | null;
  pedido_id: string | null;
};

type PresupuestoRow = {
  id: string;
  numero: number;
  fecha: string;
  total: number;
  estado: string;
  pdf_url: string | null;
  cliente: { nombre: string; razon_social: string | null; condicion_iva?: string | null } | null;
  conversiones?: PresupuestoConversiones;
};

function FilaAcciones({
  presupuestoId,
  estado,
  canEdit,
  tienePedidos,
  tieneFacturador,
  tienePos,
  conversiones,
  onHecho,
  tenantIva,
  clienteIva,
}: {
  presupuestoId: string;
  estado: string;
  canEdit: boolean;
  tienePedidos: boolean;
  tieneFacturador: boolean;
  /** Módulo POS: permite emitir ticket (comprobante no fiscal) con los ítems del presupuesto. */
  tienePos: boolean;
  conversiones?: PresupuestoConversiones;
  onHecho: () => void;
  tenantIva: string | null;
  clienteIva: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const tipoFacturaEmitir = useMemo(
    () =>
      determinarTipoFactura(normalizarCondicionIVA(tenantIva), normalizarCondicionIVA(clienteIva)),
    [tenantIva, clienteIva],
  );

  const anulado = estado === 'anulado';
  const ticketEmitido = conversiones?.ticket_id ?? null;
  const facturaEmitida = conversiones?.factura_id ?? null;
  const pedidoEmitido = conversiones?.pedido_id ?? null;

  async function convertirPedido() {
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/presupuestos/${presupuestoId}/convertir-a-pedido`, {
      method: 'POST',
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) {
      setErr(json.error ?? 'Error');
      return;
    }
    onHecho();
    router.push(`/pedidos/${json.pedido_id}`);
  }

  async function convertirFactura() {
    setBusy(true);
    setErr(null);
    const stockBloqueante = normalizePosPrefs(await fetchEffectivePosPrefsOnly()).stockBloqueante;
    const res = await fetch(`/api/presupuestos/${presupuestoId}/convertir-a-factura`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo: tipoFacturaEmitir, stock_bloqueante: stockBloqueante }),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) {
      setErr(json.error ?? 'Error');
      return;
    }
    onHecho();
    if (json.comprobante_id) {
      router.push(`/facturacion/${json.comprobante_id}`);
    }
  }

  async function emitirTicket() {
    setBusy(true);
    setErr(null);
    const stockBloqueante = normalizePosPrefs(await fetchEffectivePosPrefsOnly()).stockBloqueante;
    const res = await fetch(`/api/presupuestos/${presupuestoId}/convertir-a-ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stock_bloqueante: stockBloqueante, metodo_pago: 'efectivo' }),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) {
      setErr(json.error ?? 'Error');
      return;
    }
    onHecho();
    if (json.comprobante_id) {
      router.push(`/facturacion/${json.comprobante_id}`);
    }
  }

  if (!canEdit || anulado) {
    return err ? <span className="text-xs text-destructive">{err}</span> : null;
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-2">
        {tienePedidos && !pedidoEmitido ? (
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void convertirPedido()}>
            Convertir a pedido
          </Button>
        ) : null}
        {tieneFacturador && !facturaEmitida && !ticketEmitido ? (
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="text-xs text-muted-foreground"
              title="Letra según IVA del negocio y del cliente"
            >
              {formatearTipoComprobante(tipoFacturaEmitir)}
            </span>
            <Button type="button" size="sm" disabled={busy} onClick={() => void convertirFactura()}>
              Convertir a factura
            </Button>
          </div>
        ) : null}
        {tienePos && !ticketEmitido ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            title="Comprobante no fiscal (ticket), misma orden de venta. No requiere abrir caja en el POS. Podés fiscalizarlo después."
            disabled={busy}
            onClick={() => void emitirTicket()}
          >
            Emitir ticket
          </Button>
        ) : null}
      </div>
      <div className="flex flex-col items-end gap-0.5 text-xs">
        {pedidoEmitido ? (
          <Link href={`/pedidos/${pedidoEmitido}`} className="text-primary underline">
            Ver pedido
          </Link>
        ) : null}
        {facturaEmitida ? (
          <Link href={`/facturacion/${facturaEmitida}`} className="text-primary underline">
            {conversiones?.factura_tipo
              ? formatearTipoComprobante(conversiones.factura_tipo)
              : 'Factura'}
            {conversiones?.factura_numero != null ? ` #${conversiones.factura_numero}` : ''} emitida
          </Link>
        ) : null}
        {ticketEmitido ? (
          <Link href={`/facturacion/${ticketEmitido}`} className="text-primary underline">
            Ticket{conversiones?.ticket_numero != null ? ` #${conversiones.ticket_numero}` : ''} emitido
          </Link>
        ) : null}
      </div>
      {err && !ticketEmitido && !facturaEmitida && !pedidoEmitido ? (
        <span className="text-xs text-destructive">{err}</span>
      ) : null}
    </div>
  );
}

export function PresupuestosListaClient({ showMainHeading = true }: { showMainHeading?: boolean }) {
  const { canEdit } = useDashboardRole();
  const { modulos, loading: modulosLoading } = useModulos();
  const [lista, setLista] = useState<PresupuestoRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tenantIva, setTenantIva] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      pagina: String(pagina),
      por_pagina: '25',
    });
    const res = await fetch(`/api/presupuestos?${params}`);
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? 'Error al cargar');
      setLista([]);
      setTenantIva(null);
    } else {
      setError(null);
      setLista(json.presupuestos ?? []);
      setTotal(json.total ?? 0);
      setTenantIva(
        typeof json.tenant_condicion_iva === 'string' || json.tenant_condicion_iva === null
          ? json.tenant_condicion_iva
          : null,
      );
    }
    setLoading(false);
  }, [pagina]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  const totalPaginas = Math.max(1, Math.ceil(total / 25));

  return (
    <div className={cn('space-y-6', showMainHeading && 'mx-auto max-w-6xl')}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          {showMainHeading ? (
            <h1 className="text-2xl font-semibold tracking-tight">Presupuestos</h1>
          ) : (
            <h2 className="text-lg font-semibold tracking-tight">Presupuestos</h2>
          )}
          <p className="mt-1 text-sm text-muted-foreground">
            Cotizaciones sin impacto en stock mientras son solo presupuesto. Podés generar pedido, factura
            fiscal, o un ticket de venta no fiscalizado vinculado a la misma orden (no requiere caja abierta).
          </p>
        </div>
        {canEdit && modulos.presupuestos ? (
          <Link href="/presupuestos/nuevo" className={cn(buttonVariants(), 'shrink-0')}>
            Nuevo presupuesto
          </Link>
        ) : null}
      </div>

      {!modulosLoading && !modulos.facturador_simple ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          Para convertir un presupuesto en factura necesitás el módulo de facturación activo. Podés crear
          y gestionar cotizaciones con el módulo de presupuestos.
        </p>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : lista.length === 0 ? (
        <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground shadow-sm">
          No hay presupuestos todavía.
          {canEdit && modulos.presupuestos ? (
            <>
              {' '}
              <Link href="/presupuestos/nuevo" className="text-primary underline">
                Crear uno
              </Link>
            </>
          ) : null}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Número</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>PDF</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-sm">
                      <Link href={`/presupuestos/${p.id}`} className="hover:underline">
                        #{p.numero}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(p.fecha)}</TableCell>
                    <TableCell>{p.cliente?.razon_social || p.cliente?.nombre || '—'}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(p.total)}</TableCell>
                    <TableCell className="text-sm capitalize">{p.estado}</TableCell>
                    <TableCell>
                      {p.pdf_url ? (
                        <a
                          href={p.pdf_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-primary underline"
                        >
                          Abrir
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <FilaAcciones
                        presupuestoId={p.id}
                        estado={p.estado}
                        canEdit={canEdit}
                        tienePedidos={modulos.pedidos}
                        tieneFacturador={modulos.facturador_simple}
                        tienePos={modulos.facturador_pos}
                        conversiones={p.conversiones}
                        onHecho={() => void load()}
                        tenantIva={tenantIva}
                        clienteIva={p.cliente?.condicion_iva ?? null}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">
              {total} presupuesto{total !== 1 ? 's' : ''}
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pagina <= 1}
                onClick={() => setPagina((x) => Math.max(1, x - 1))}
              >
                Anterior
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pagina >= totalPaginas}
                onClick={() => setPagina((x) => x + 1)}
              >
                Siguiente
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
