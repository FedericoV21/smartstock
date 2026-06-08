'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Ban, Download, Printer, Receipt, RefreshCw, RotateCcw, Undo2 } from 'lucide-react';

import { AnularComprobanteDialog } from '@/components/facturacion/anular-comprobante-dialog';
import {
  RevertirFacturaImportadaDialog,
  type ReversionFacturaImportadaResumen,
} from '@/components/facturacion/revertir-factura-importada-dialog';
import { useDashboardRole } from '@/components/dashboard/dashboard-role-context';
import { useConfirm } from '@/hooks/use-confirm';
import { useModulos } from '@/hooks/useModulos';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { caeAfipFormatoValido, fiscalSinCaeValido, puedeAnularComprobanteInterno } from '@/lib/facturacion/cae-afip';
import { formatearNumeroComprobante } from '@/lib/facturacion/formato';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils/formatters';
import { CadenaDeOrden } from '@/components/facturacion/cadena-de-orden';
import { downloadTicketHtml, printTicket, type TicketData } from '@/components/pos/ticket-termico';
import { fetchEffectivePosPrefsOnly, fetchPosPrefsFromApi, type EmisorTicketApi } from '@/lib/pos/fetch-pos-prefs';
import { comprobanteDetalleATicketData, type ComprobanteParaTicket } from '@/lib/pos/ticket-data-from-comprobante';
import { normalizePosPrefs } from '@/lib/pos/prefs';

const TIPO_LABELS: Record<string, string> = {
  factura_a: 'Factura A',
  factura_b: 'Factura B',
  factura_c: 'Factura C',
  nota_credito_a: 'Nota de Crédito A',
  nota_credito_b: 'Nota de Crédito B',
  nota_credito_c: 'Nota de Crédito C',
  remito: 'Remito',
  devolucion_remito: 'Devolución de remito',
  presupuesto: 'Presupuesto',
  ticket: 'Ticket',
};

const ESTADO_STYLES: Record<string, string> = {
  emitido: 'bg-emerald-100 text-emerald-800',
  importado: 'bg-sky-100 text-sky-900',
  borrador: 'bg-gray-100 text-gray-800',
  anulado: 'bg-red-100 text-red-800',
  pendiente_arca: 'bg-yellow-100 text-yellow-800',
  pendiente_posnet: 'bg-amber-100 text-amber-900',
  pendiente_qr: 'bg-amber-100 text-amber-900',
  pendiente_transferencia_mp: 'bg-amber-100 text-amber-900',
  error_arca: 'bg-red-100 text-red-800',
};

type ComprobanteDetalle = {
  id: string;
  tipo: string;
  tipo_operacion?: string;
  /** URL QR AFIP rearmada en el detalle (reimpresión de ticket / térmico). */
  arca_qr_url?: string | null;
  fiscalizado_por_id: string | null;
  factura_fiscal: { id: string; tipo: string; numero: number } | null;
  ticket_origen?: { id: string; numero: number | null; numero_caja?: number | null } | null;
  remito_origen?: { id: string; numero: number | null } | null;
  numero_orden: number;
  numero: number | null;
  numero_caja?: number | null;
  linea_caja_ticket?: string | null;
  created_at: string;
  fecha: string;
  subtotal: number;
  iva_monto: number;
  iva_porcentaje: number;
  total: number;
  descuento_global_pct?: number;
  recargo_global_pct?: number;
  descuento_global_monto?: number;
  recargo_global_monto?: number;
  estado: string;
  punto_de_venta: number | null;
  pdf_url: string | null;
  total_mercaderia?: number | null;
  financiacion_monto?: number | null;
  financiacion_descripcion?: string | null;
  imp_trib_comercial?: number | null;
  impuesto_interno_monto?: number | null;
  percepcion_iibb_monto?: number | null;
  percepcion_iva_monto?: number | null;
  metodo_pago?: string | null;
  metodo_pago_detalle?: unknown;
  cae: string | null;
  cae_vencimiento: string | null;
  notas: string | null;
  usuario?: { nombre: string; apellido: string | null } | null;
  sucursal?: { id: string; nombre: string | null; codigo: string | null } | null;
  cliente: {
    nombre: string;
    razon_social: string | null;
    cuit_dni: string | null;
    condicion_iva: string | null;
  } | null;
  proveedor: { nombre: string; cuit: string | null } | null;
  items: {
    id: string;
    producto_id?: string | null;
    cantidad: number;
    precio_unitario: number;
    subtotal: number;
    promocion_descripcion?: string | null;
    descuento_promo_monto?: number | null;
    producto: {
      nombre: string;
      codigo: string | null;
      codigo_barras?: string | null;
      iva_porcentaje?: number | null;
      unidad?: string;
      es_pesable?: boolean;
    } | null;
    descuento_manual_pct?: number;
    recargo_manual_pct?: number;
  }[];
  actualizaciones_costos_factura?: {
    producto_id: string;
    codigo: string | null;
    codigo_barras: string | null;
    nombre: string;
    precio_costo_anterior: number | null;
    precio_costo_nuevo: number | null;
    precio_venta_anterior: number | null;
    precio_venta_nuevo: number | null;
    variacion_pct: number | null;
  }[];
  motivo_anulacion?: string | null;
  anulado_at?: string | null;
  anulado_por_usuario?: { nombre: string; apellido: string | null } | null;
  ultimo_error_arca_mensaje?: string | null;
};

type SucursalResumen = { id: string; nombre: string | null; codigo: string | null };

type SucursalActivaResponse = {
  sucursal_default_id: string | null;
  sucursales?: Array<{
    id: string;
    nombre?: string | null;
    codigo?: string | null;
  }>;
};

function formatVariacionPct(v: number | null): string {
  if (v == null) return 'nuevo costo';
  return `${v >= 0 ? '+' : ''}${v.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

function urlHojaEtiquetasProductos(productoIds: string[]): string {
  const params = new URLSearchParams();
  for (const id of [...new Set(productoIds)]) {
    params.append('agregar', id);
  }
  return `/productos/hoja-etiquetas?${params.toString()}`;
}

function formatSucursalLabel(sucursal: { nombre?: string | null; codigo?: string | null } | null | undefined): string {
  if (!sucursal) return 'Sin sucursal';
  const nombre = sucursal.nombre?.trim() || 'Sucursal';
  const codigo = sucursal.codigo?.trim();
  return codigo ? `${nombre} (${codigo})` : nombre;
}

function finiteNumber(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function numeroTicketCajaLabel(c: {
  tipo?: string | null;
  numero?: number | null;
  numero_caja?: number | null;
  numero_orden?: number | null;
}): string | null {
  if (c.tipo !== 'ticket') return null;
  const numeroCaja = finiteNumber(c.numero_caja);
  if (numeroCaja != null) return `Nro. ${numeroCaja}`;
  const numeroFiscal = finiteNumber(c.numero);
  if (numeroFiscal != null && numeroFiscal > 0) return `Nro. ${numeroFiscal}`;
  const orden = finiteNumber(c.numero_orden);
  return orden != null ? `Orden #${orden}` : null;
}

function numeroArchivoTicket(c: ComprobanteDetalle): string {
  const numeroCaja = finiteNumber(c.numero_caja);
  if (numeroCaja != null) return String(numeroCaja);
  const numeroFiscal = finiteNumber(c.numero);
  if (numeroFiscal != null && numeroFiscal > 0) return String(numeroFiscal);
  const orden = finiteNumber(c.numero_orden);
  if (orden != null) return `orden-${orden}`;
  return c.id.slice(0, 8);
}

function ticketDownloadFileName(c: ComprobanteDetalle): string {
  return `ticket-${numeroArchivoTicket(c)}.html`;
}

export type ComprobanteDetalleVariant = 'facturacion' | 'presupuesto';

export function ComprobanteDetalleView({
  apiPath,
  backHref,
  variant,
}: {
  apiPath: string;
  backHref: string;
  variant: ComprobanteDetalleVariant;
}) {
  const router = useRouter();
  const { canEdit, isAdmin, isSuperAdmin } = useDashboardRole();
  const { modulos, loading: modulosLoading } = useModulos();
  const { id } = useParams<{ id: string }>();
  const [comprobante, setComprobante] = useState<ComprobanteDetalle | null>(null);
  const [sucursalActiva, setSucursalActiva] = useState<SucursalResumen | null>(null);
  const [loading, setLoading] = useState(true);
  const [pdfRetrying, setPdfRetrying] = useState(false);
  const [arcaRetrying, setArcaRetrying] = useState(false);
  const [arcaRetryMessage, setArcaRetryMessage] = useState<string | null>(null);
  const [arcaRetryError, setArcaRetryError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generandoPedido, setGenerandoPedido] = useState(false);
  const [generarPedidoError, setGenerarPedidoError] = useState<string | null>(null);
  const [emitiendoTicket, setEmitiendoTicket] = useState(false);
  const [emitirTicketError, setEmitirTicketError] = useState<string | null>(null);
  const [anularDialogOpen, setAnularDialogOpen] = useState(false);
  const [revertirImportadaDialogOpen, setRevertirImportadaDialogOpen] = useState(false);
  const { alert, ConfirmDialog } = useConfirm();

  const esVistaPresupuesto = variant === 'presupuesto';

  const load = useCallback(
    async (opts?: { quiet?: boolean }) => {
      if (!opts?.quiet) setLoading(true);
      const res = await fetch(`${apiPath}/${id}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Error al cargar');
      } else {
        setError(null);
        setComprobante(json);
      }
      if (!opts?.quiet) setLoading(false);
    },
    [apiPath, id],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!isAdmin && !isSuperAdmin) return;
    let cancelled = false;
    async function loadSucursalActiva() {
      try {
        const res = await fetch('/api/configuracion/sucursal-activa');
        const json = (await res.json()) as SucursalActivaResponse;
        if (!res.ok || cancelled) return;
        const rows = json.sucursales ?? [];
        const active =
          (json.sucursal_default_id
            ? rows.find((s) => s.id === json.sucursal_default_id)
            : null) ?? rows[0] ?? null;
        setSucursalActiva(
          active
            ? {
                id: active.id,
                nombre: active.nombre ?? null,
                codigo: active.codigo ?? null,
              }
            : null,
        );
      } catch {
        /* La sucursal del comprobante sigue visible aunque falle esta comparacion. */
      }
    }
    void loadSucursalActiva();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, isSuperAdmin]);

  const prepararTicketTermico = useCallback(async (comprob: ComprobanteDetalle, overrides?: Partial<TicketData>) => {
    let pos: Awaited<ReturnType<typeof fetchPosPrefsFromApi>> = null;
    try {
      pos = await fetchPosPrefsFromApi();
    } catch {
      /* ignore: fallback emisor y ancho default */
    }
    const ancho = pos ? normalizePosPrefs(pos.effective_pos_prefs).anchoTicket : '80mm';
    const emisor: EmisorTicketApi =
      pos?.emisor_ticket && pos.emisor_ticket.nombre_ticket?.trim()
        ? pos.emisor_ticket
        : {
            nombre_ticket: 'Nexus',
            cuit: null,
            domicilio: null,
            logo_url: null,
          };
    const ticketData = comprobanteDetalleATicketData(comprob as ComprobanteParaTicket, emisor, {
      ivaDefault: comprob.iva_porcentaje,
    });
    return {
      ancho,
      data: overrides ? { ...ticketData, ...overrides } : ticketData,
    };
  }, []);

  const ejecutarPrintTermico = useCallback(async (comprob: ComprobanteDetalle, overrides?: Partial<TicketData>) => {
    const ticket = await prepararTicketTermico(comprob, overrides);
    printTicket(ticket.data, ticket.ancho);
  }, [prepararTicketTermico]);

  const ejecutarDownloadTermico = useCallback(async (comprob: ComprobanteDetalle, overrides?: Partial<TicketData>) => {
    const ticket = await prepararTicketTermico(comprob, overrides);
    downloadTicketHtml(ticket.data, ticket.ancho, ticketDownloadFileName(comprob));
  }, [prepararTicketTermico]);

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
        <Link href={backHref} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
          ← Volver
        </Link>
      </div>
    );
  }

  const c = comprobante;
  const sucursalComprobanteLabel = formatSucursalLabel(c.sucursal);
  const sucursalActivaLabel = formatSucursalLabel(sucursalActiva);
  const puedeVerTodoElNegocio = isAdmin || isSuperAdmin;
  const viendoOtraSucursal = Boolean(
    puedeVerTodoElNegocio &&
      c.sucursal?.id &&
      sucursalActiva?.id &&
      c.sucursal.id !== sucursalActiva.id,
  );
  const documentoSucursalTexto = c.tipo.startsWith('factura_') ? 'Esta factura' : 'Este comprobante';
  const esFiscalSinCaeValido = fiscalSinCaeValido(c.tipo, c.cae);
  const numeroFormateadoFiscal = formatearNumeroComprobante(
    c.punto_de_venta ?? 1,
    esFiscalSinCaeValido ? null : c.numero,
    {
      sinNumeroFiscalAun:
        ((c.estado === 'pendiente_arca' || c.estado === 'error_arca') && c.numero == null) ||
        esFiscalSinCaeValido,
      numeroOrden: c.numero_orden,
    },
  );
  const numeroFormateado = numeroTicketCajaLabel(c) ?? numeroFormateadoFiscal;
  const esCompraImportada = c.tipo_operacion === 'compra' && c.estado === 'importado';
  const cambiosCostoFactura = c.actualizaciones_costos_factura ?? [];
  const cambiosCostoConCodigo = cambiosCostoFactura.filter((p) => p.codigo_barras?.trim());
  const cambiosCostoSinCodigo = cambiosCostoFactura.filter((p) => !p.codigo_barras?.trim());
  const esTipoFiscalImprimible = c.tipo.startsWith('factura_') || c.tipo.startsWith('nota_credito_');
  const esTicketVentaTermico =
    !esVistaPresupuesto &&
    c.tipo === 'ticket' &&
    c.tipo_operacion !== 'compra' &&
    c.estado === 'emitido';
  const ticketTieneReferenciaTermica =
    c.tipo === 'ticket' &&
    (finiteNumber(c.numero_caja) != null ||
      finiteNumber(c.numero) != null ||
      finiteNumber(c.numero_orden) != null);
  const esCopiaControlSinCae =
    !esVistaPresupuesto &&
    c.tipo_operacion !== 'compra' &&
    esTipoFiscalImprimible &&
    esFiscalSinCaeValido &&
    (c.estado === 'emitido' || c.estado === 'pendiente_arca' || c.estado === 'error_arca');

  const puedeReimprimirTermicoPos =
    !esVistaPresupuesto &&
    c.tipo_operacion !== 'compra' &&
    ((c.estado === 'emitido' &&
      !esFiscalSinCaeValido &&
      ((c.tipo === 'ticket' && ticketTieneReferenciaTermica) ||
        (esTipoFiscalImprimible && c.numero != null))) ||
      esCopiaControlSinCae);
  const puedeDescargarTicketTermico = esTicketVentaTermico && ticketTieneReferenciaTermica;
  const ticketTermicoFallbackOverrides: Partial<TicketData> | undefined =
    c.tipo === 'ticket' &&
    finiteNumber(c.numero) == null &&
    finiteNumber(c.numero_caja) == null &&
    finiteNumber(c.numero_orden) != null
      ? {
          numeroTicketLabel: `Ord. ${finiteNumber(c.numero_orden)}`,
          ordenVentaNumero: finiteNumber(c.numero_orden),
        }
      : undefined;

  const puedeReimprimirTicketOrigen = Boolean(
    !esVistaPresupuesto &&
      c.ticket_origen &&
      c.tipo_operacion !== 'compra' &&
      c.tipo !== 'ticket' &&
      c.estado === 'emitido' &&
      (c.tipo.startsWith('factura_') || c.tipo.startsWith('nota_credito_')),
  );

  const puedeReintentarArca =
    !esVistaPresupuesto &&
    canEdit &&
    !modulosLoading &&
    modulos.facturador_arca &&
    esFiscalSinCaeValido &&
    (c.estado === 'error_arca' || c.estado === 'pendiente_arca' || c.estado === 'emitido');

  const puedeAnularInterno =
    !esVistaPresupuesto &&
    canEdit &&
    !modulosLoading &&
    (modulos.facturador_arca || modulos.facturador_simple || modulos.facturador_pos) &&
    puedeAnularComprobanteInterno({
      estado: c.estado,
      tipo: c.tipo,
      cae: c.cae,
      tipoOperacion: c.tipo_operacion,
    }).ok;
  const puedeRevertirCompraImportada =
    esCompraImportada &&
    canEdit &&
    !modulosLoading &&
    (modulos.lector_facturas || modulos.facturador_simple);

  function resumenReversionTexto(resumen: ReversionFacturaImportadaResumen): string {
    const ajusteNeto = resumen.cuenta_corriente_ajuste_neto ?? 0;
    const partes = [
      `Stock: ${resumen.stock_movimientos_revertidos} movimiento(s) revertido(s).`,
      resumen.cuenta_corriente_revertida > 0
        ? `Deuda proveedor: ${formatCurrency(resumen.cuenta_corriente_revertida)} revertidos.`
        : 'Deuda proveedor: sin cambios.',
      (resumen.pagos_proveedor_compensados ?? 0) > 0
        ? `Pagos: ${formatCurrency(resumen.pagos_proveedor_total_compensado ?? 0)} compensados.`
        : null,
      Math.abs(ajusteNeto) > 0.000001
        ? `Ajuste neto CC: ${ajusteNeto > 0 ? '+' : ''}${formatCurrency(ajusteNeto)}.`
        : 'Ajuste neto CC: sin movimiento.',
      `Catalogo: ${resumen.productos_restaurados} restaurado(s), ${resumen.productos_desactivados} desactivado(s), ${resumen.productos_omitidos} omitido(s).`,
    ].filter((parte): parte is string => Boolean(parte));
    return partes.join('\n');
  }

  return (
    <>
      {ConfirmDialog}
      <AnularComprobanteDialog
        open={anularDialogOpen}
        onOpenChange={setAnularDialogOpen}
        comprobanteId={c.id}
        apiBasePath={apiPath}
        onAnulado={() => void load({ quiet: true })}
      />
      <RevertirFacturaImportadaDialog
        open={revertirImportadaDialogOpen}
        onOpenChange={setRevertirImportadaDialogOpen}
        comprobanteId={c.id}
        apiBasePath={apiPath}
        onRevertida={async (resumen) => {
          await load({ quiet: true });
          await alert({
            title: 'Factura importada revertida',
            description: resumenReversionTexto(resumen),
          });
        }}
      />
      <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={backHref} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
          ← Volver
        </Link>
      </div>

      {esVistaPresupuesto ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
          <p className="font-semibold">Cotización formal</p>
          <p className="mt-1 text-slate-700 dark:text-slate-300">
            Este documento no es una factura ni tiene validez fiscal. Si el módulo de pedidos está
            activo, podés generar abajo un pedido en borrador. Con facturación o POS podés, desde
            el listado o desde aquí, generar factura o ticket (venta en mostrador no fiscal) con la
            misma orden de venta.
          </p>
        </div>
      ) : null}

      {esVistaPresupuesto &&
      canEdit &&
      !modulosLoading &&
      modulos.pedidos &&
      c.estado !== 'anulado' &&
      c.items.length > 0 ? (
        <div className="rounded-lg border border-dashed border-primary/35 bg-primary/5 p-4 text-sm text-foreground">
          <p className="font-medium">Orden de pedido</p>
          <p className="mt-1 text-muted-foreground">
            Se crea un pedido en borrador con los mismos productos, cantidades y precios (se aplican
            promociones vigentes del día, igual que al convertir desde el listado).
          </p>
          {generarPedidoError ? (
            <p className="mt-2 text-xs text-destructive">{generarPedidoError}</p>
          ) : null}
          <Button
            type="button"
            className="mt-3"
            disabled={generandoPedido}
            onClick={async () => {
              setGenerandoPedido(true);
              setGenerarPedidoError(null);
              try {
                const res = await fetch(`${apiPath}/${id}/convertir-a-pedido`, { method: 'POST' });
                const json = (await res.json()) as { pedido_id?: string; error?: string };
                if (!res.ok) {
                  setGenerarPedidoError(
                    typeof json.error === 'string' ? json.error : 'No se pudo generar el pedido',
                  );
                  return;
                }
                if (json.pedido_id) {
                  router.push(`/pedidos/${json.pedido_id}`);
                }
              } catch {
                setGenerarPedidoError('Error de red');
              } finally {
                setGenerandoPedido(false);
              }
            }}
          >
            {generandoPedido ? 'Generando…' : 'Generar pedido'}
          </Button>
        </div>
      ) : null}

      {esVistaPresupuesto &&
      canEdit &&
      !modulosLoading &&
      modulos.facturador_pos &&
      c.estado !== 'anulado' &&
      c.items.length > 0 ? (
        <div className="rounded-lg border border-dashed border-amber-500/40 bg-amber-500/5 p-4 text-sm text-foreground">
          <p className="font-medium">Ticket (venta no fiscal)</p>
          <p className="mt-1 text-muted-foreground">
            Genera un comprobante tipo ticket con los ítems y descuentos de este presupuesto, misma
            orden de venta; podés fiscalizarlo después. No requiere abrir caja en el POS. Respeta en
            servidor la preferencia de bloqueo de stock del POS.
          </p>
          {emitirTicketError ? <p className="mt-2 text-xs text-destructive">{emitirTicketError}</p> : null}
          <Button
            type="button"
            variant="outline"
            className="mt-3"
            disabled={emitiendoTicket}
            onClick={async () => {
              setEmitiendoTicket(true);
              setEmitirTicketError(null);
              try {
                const stockBloqueante = normalizePosPrefs(await fetchEffectivePosPrefsOnly()).stockBloqueante;
                const res = await fetch(`${apiPath}/${id}/convertir-a-ticket`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ stock_bloqueante: stockBloqueante, metodo_pago: 'efectivo' }),
                });
                const json = (await res.json()) as { comprobante_id?: string; error?: string };
                if (!res.ok) {
                  setEmitirTicketError(
                    typeof json.error === 'string' ? json.error : 'No se pudo emitir el ticket',
                  );
                  return;
                }
                if (json.comprobante_id) {
                  router.push(`/facturacion/${json.comprobante_id}`);
                }
              } catch {
                setEmitirTicketError('Error de red');
              } finally {
                setEmitiendoTicket(false);
              }
            }}
          >
            {emitiendoTicket ? 'Emitiendo…' : 'Emitir ticket'}
          </Button>
        </div>
      ) : null}

      <CadenaDeOrden numeroOrden={c.numero_orden ?? null} documentoActualId={c.id} />

      {viendoOtraSucursal ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50/90 p-4 text-sm text-amber-950">
          <p className="font-semibold">Comprobante de otra sucursal</p>
          <p className="mt-1 text-amber-900/90">
            {documentoSucursalTexto} pertenece a {sucursalComprobanteLabel}. Tu sucursal activa es{' '}
            {sucursalActivaLabel}.
          </p>
        </div>
      ) : null}

      {!esVistaPresupuesto &&
      (c.tipo === 'factura_a' || c.tipo === 'factura_b' || c.tipo === 'factura_c') &&
      c.ticket_origen ? (
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
          <p className="font-semibold">Factura posterior a ticket (orden {c.numero_orden ?? '—'})</p>
          <p className="mt-1 text-sky-900/90">
            La venta original en mostrador es el{' '}
            <Link
              href={`/facturacion/${c.ticket_origen.id}`}
              className="font-medium text-primary underline"
            >
              Ticket {numeroTicketCajaLabel({
                tipo: 'ticket',
                numero: c.ticket_origen.numero,
                numero_caja: c.ticket_origen.numero_caja ?? null,
                numero_orden: c.numero_orden,
              }) ?? 'sin numero'}
            </Link>
            . El stock se movió al emitir el ticket; esta factura es el respaldo fiscal.
          </p>
        </div>
      ) : null}

      {!esVistaPresupuesto && c.tipo === 'devolucion_remito' && c.remito_origen ? (
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 text-sm text-orange-950">
          <p className="font-semibold">Devolución de remito (orden {c.numero_orden ?? '—'})</p>
          <p className="mt-1 text-orange-900/90">
            Esta devolución revierte mercadería del{' '}
            <Link
              href={`/facturacion/${c.remito_origen.id}`}
              className="font-medium text-primary underline"
            >
              Remito{' '}
              {c.remito_origen.numero != null
                ? `#${String(c.remito_origen.numero).padStart(8, '0')}`
                : 'sin número'}
            </Link>
            . El stock se reingresó al confirmar; no es un comprobante fiscal.
          </p>
        </div>
      ) : null}

      {!esVistaPresupuesto && c.tipo === 'ticket' && c.factura_fiscal ? (
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

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            {esVistaPresupuesto
              ? `Presupuesto formal · ref. interna orden ${c.numero_orden != null ? `#${c.numero_orden}` : '—'}`
              : c.tipo_operacion === 'compra'
                ? `Orden interna ${c.numero_orden != null ? `#${c.numero_orden}` : '—'}`
                : `Orden de venta ${c.numero_orden != null ? `#${c.numero_orden}` : '—'}`}
          </p>
          <h1 className="text-xl font-bold">
            {esVistaPresupuesto ? 'Presupuesto' : TIPO_LABELS[c.tipo] ?? c.tipo} {numeroFormateado}
          </h1>
          <p className="text-muted-foreground">{formatDate(c.fecha)}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Orden creada: {formatDateTime(c.created_at)}
          </p>
          {c.sucursal ? (
            <p className="mt-1 text-sm font-medium text-foreground">
              Sucursal: {sucursalComprobanteLabel}
            </p>
          ) : null}
          {esCompraImportada ? (
            <p className="mt-1 text-sm text-sky-900">
              Documento del proveedor registrado en el sistema (no emitido por vos desde Smart Stock).
            </p>
          ) : null}
          {c.tipo_operacion === 'compra' && c.proveedor ? (
            <p className="mt-1 text-sm">
              Proveedor: {c.proveedor.nombre}
              {c.proveedor.cuit ? (
                <span className="ml-2 font-mono text-xs text-muted-foreground">
                  ({c.proveedor.cuit})
                </span>
              ) : null}
            </p>
          ) : null}
          {c.tipo_operacion !== 'compra' && c.cliente ? (
            <p className="mt-1 text-sm">
              Cliente: {c.cliente.razon_social || c.cliente.nombre}
              {c.cliente.cuit_dni ? (
                <span className="ml-2 font-mono text-xs text-muted-foreground">
                  ({c.cliente.cuit_dni})
                </span>
              ) : null}
            </p>
          ) : null}
          {esVistaPresupuesto && !c.cliente ? (
            <p className="mt-1 text-sm text-muted-foreground">Cliente: sin datos en cuenta</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {c.pdf_url ? (
            <>
              <a
                href={c.pdf_url}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-1')}
              >
                <Download className="h-4 w-4" /> Descargar PDF
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
          ) : c.estado === 'emitido' && !puedeDescargarTicketTermico ? (
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
          {puedeDescargarTicketTermico ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => {
                void ejecutarDownloadTermico(c, ticketTermicoFallbackOverrides);
              }}
            >
              <Download className="h-4 w-4" />
              Descargar ticket
            </Button>
          ) : null}
          {puedeReimprimirTermicoPos ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="gap-1"
              onClick={() => {
                const errorArca = c.ultimo_error_arca_mensaje?.trim();
                const extra = errorArca
                  ? ` - ${errorArca.slice(0, 120)}${errorArca.length > 120 ? '...' : ''}`
                  : '';
                const numeroLabel =
                  c.numero != null && Number(c.numero) > 0
                    ? String(Number(c.numero))
                    : c.numero_orden != null
                      ? `Ord. ${c.numero_orden}`
                      : '-';
                void ejecutarPrintTermico(
                  c,
                  esCopiaControlSinCae
                    ? {
                        numeroTicketLabel: numeroLabel,
                        ordenVentaNumero: c.numero_orden ?? null,
                        cabeceraLeyenda: `SIN CAE - Completá en Facturación${extra}`,
                      }
                    : ticketTermicoFallbackOverrides,
                );
              }}
            >
              <Receipt className="h-4 w-4" />{' '}
              {esCopiaControlSinCae ? 'Imprimir ticket (copia de control)' : 'Imprimir ticket'}
            </Button>
          ) : null}
          {puedeReimprimirTicketOrigen && c.ticket_origen ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1"
              title="Ticket no fiscal (mostrador) de la misma orden, como en el POS al emitir solo el ticket"
              onClick={() => {
                void (async () => {
                  if (!c.ticket_origen) return;
                  const r = await fetch(`${apiPath}/${c.ticket_origen.id}`);
                  const json = (await r.json()) as ComprobanteDetalle & { error?: string };
                  if (!r.ok) {
                    await alert({
                      title: 'No se pudo cargar el ticket',
                      description:
                        typeof json.error === 'string' ? json.error : 'No se pudo cargar el ticket de mostrador.',
                    });
                    return;
                  }
                  void ejecutarPrintTermico(json);
                })();
              }}
            >
              <Receipt className="h-4 w-4" />
              Mostrador
            </Button>
          ) : null}
          {puedeRevertirCompraImportada ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="gap-1"
              onClick={() => setRevertirImportadaDialogOpen(true)}
            >
              <RotateCcw className="h-4 w-4" />
              Revertir
            </Button>
          ) : null}
          {!esVistaPresupuesto &&
          canEdit &&
          !modulosLoading &&
          modulos.facturador_simple &&
          c.tipo === 'remito' &&
          c.tipo_operacion !== 'compra' &&
          c.estado === 'emitido' &&
          c.numero != null ? (
            <Link
              href={`/facturacion/nueva?desde_remito=${c.id}`}
              className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'inline-flex items-center gap-1')}
            >
              <Undo2 className="h-4 w-4" />
              Devolución
            </Link>
          ) : null}
          {!esVistaPresupuesto &&
          canEdit &&
          !modulosLoading &&
          modulos.facturador_simple &&
          (c.tipo === 'factura_a' || c.tipo === 'factura_b' || c.tipo === 'factura_c') &&
          c.estado === 'emitido' &&
          c.numero != null &&
          !esFiscalSinCaeValido ? (
            <Link
              href={`/facturacion/nueva?desde_factura=${c.id}`}
              className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'inline-flex items-center gap-1')}
            >
              <Undo2 className="h-4 w-4" />
              Nota de crédito
            </Link>
          ) : null}
          {puedeAnularInterno ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1 text-destructive hover:text-destructive"
              onClick={() => setAnularDialogOpen(true)}
            >
              <Ban className="h-4 w-4" />
              Anular
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2 py-1 text-xs font-medium ${
            c.estado === 'emitido' && fiscalSinCaeValido(c.tipo, c.cae)
              ? 'bg-amber-100 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100'
              : (ESTADO_STYLES[c.estado] ?? 'bg-gray-100 text-gray-800')
          }`}
          title={
            c.estado === 'emitido' && fiscalSinCaeValido(c.tipo, c.cae)
              ? 'Sin CAE de 14 dígitos: el comprobante no está autorizado ante ARCA/AFIP.'
              : undefined
          }
        >
          {c.estado === 'emitido' && fiscalSinCaeValido(c.tipo, c.cae)
            ? 'AFIP PENDIENTE'
            : c.estado.replace('_', ' ').toUpperCase()}
        </span>
        {!esVistaPresupuesto && c.tipo === 'ticket' && c.factura_fiscal ? (
          <Link href={`/facturacion/${c.factura_fiscal.id}`} className="text-sm text-primary hover:underline">
            Ir a la factura →
          </Link>
        ) : null}
      </div>

      {!esVistaPresupuesto && c.estado === 'anulado' && c.motivo_anulacion?.trim() ? (
        <div className="rounded-lg border border-red-200 bg-red-50/90 p-4 text-sm text-red-950 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-50">
          <p className="font-medium">Comprobante anulado</p>
          <p className="mt-2 whitespace-pre-wrap">{c.motivo_anulacion.trim()}</p>
          {c.anulado_at ? (
            <p className="mt-2 text-xs text-red-800/90 dark:text-red-200/90">
              {formatDateTime(c.anulado_at)}
              {c.anulado_por_usuario
                ? ` · ${c.anulado_por_usuario.nombre}${
                    c.anulado_por_usuario.apellido ? ` ${c.anulado_por_usuario.apellido}` : ''
                  }`
                : null}
            </p>
          ) : null}
        </div>
      ) : null}

      {puedeReintentarArca ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50/90 p-4 text-sm text-amber-950">
          <p className="font-medium">
            {c.estado === 'pendiente_arca'
              ? 'Pendiente de autorización ARCA'
              : c.estado === 'emitido'
                ? 'Autorización AFIP pendiente'
                : 'ARCA no autorizó este comprobante'}
          </p>
          <p className="mt-1 text-amber-900/90">
            Acá no se editan productos ni precios: el comprobante ya quedó armado. Revisá certificado,
            ambiente y datos fiscales en Configuración ARCA (y cliente/CUIT si el error lo indica) y
            tocá el botón para volver a pedir el CAE. No se duplica el comprobante ni el número fiscal.
          </p>
          {arcaRetryError ? <p className="mt-2 text-xs text-destructive">{arcaRetryError}</p> : null}
          {arcaRetryMessage ? <p className="mt-2 text-xs text-emerald-800">{arcaRetryMessage}</p> : null}
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

      {!esVistaPresupuesto &&
      c.tipo === 'ticket' &&
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

      {caeAfipFormatoValido(c.cae) ? (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm">
          <p className="font-medium text-green-800">CAE: {c.cae}</p>
          {c.cae_vencimiento ? (
            <p className="text-green-700">Vencimiento: {formatDate(c.cae_vencimiento)}</p>
          ) : null}
        </div>
      ) : null}

      {cambiosCostoFactura.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-950">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-semibold">Costos actualizados por esta factura</p>
              <p className="mt-1 text-xs text-amber-900/90">
                Estos productos existentes cambiaron su costo al confirmar la factura. Podés imprimir etiquetas para
                los que ya tienen código de barras.
              </p>
            </div>
            {cambiosCostoConCodigo.length > 0 ? (
              <Link
                href={urlHojaEtiquetasProductos(cambiosCostoConCodigo.map((p) => p.producto_id))}
                className={cn(buttonVariants({ size: 'sm' }), 'shrink-0')}
              >
                Imprimir etiquetas
              </Link>
            ) : null}
          </div>

          <div className="mt-3 overflow-hidden rounded-lg border bg-background text-foreground">
            {cambiosCostoFactura.map((p) => (
              <div key={p.producto_id} className="border-b px-3 py-2 last:border-0">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium leading-snug">
                      {p.nombre}
                      {p.codigo ? (
                        <span className="text-muted-foreground ml-1 font-normal">({p.codigo})</span>
                      ) : null}
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      Costo: {p.precio_costo_anterior == null ? 'Sin costo' : formatCurrency(p.precio_costo_anterior)} →{' '}
                      {p.precio_costo_nuevo == null ? '—' : formatCurrency(p.precio_costo_nuevo)} ·{' '}
                      {formatVariacionPct(p.variacion_pct)}
                    </p>
                  </div>
                  {!p.codigo_barras?.trim() ? (
                    <Link
                      href={`/productos/${p.producto_id}`}
                      className={cn(buttonVariants({ variant: 'outline', size: 'xs' }), 'bg-background')}
                    >
                      Cargar código de barras
                    </Link>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          {cambiosCostoSinCodigo.length > 0 ? (
            <p className="mt-2 text-xs font-medium">
              {cambiosCostoSinCodigo.length} producto(s) no se pueden imprimir todavía porque no tienen código de
              barras.
            </p>
          ) : null}
        </div>
      ) : null}

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
                  ? c.tipo_operacion === 'compra'
                    ? Math.round(((item.subtotal * rate) / 100) * 100) / 100
                    : Math.round(((item.subtotal * rate) / (100 + rate)) * 100) / 100
                  : 0;
              const dMan = Number(item.descuento_manual_pct ?? 0);
              const rMan = Number(item.recargo_manual_pct ?? 0);
              const notaMan =
                dMan > 0.0005 || rMan > 0.0005
                  ? [dMan > 0.0005 ? `D% ${dMan}` : null, rMan > 0.0005 ? `R% ${rMan}` : null]
                      .filter(Boolean)
                      .join(' · ')
                  : null;
              return (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">
                    {item.producto?.nombre ?? '—'}
                    {notaMan ? (
                      <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                        {notaMan}
                      </span>
                    ) : null}
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
                  <TableCell className="text-right font-mono">{formatCurrency(item.subtotal)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="space-y-1 text-right text-sm">
        {(() => {
          const dg = Number(c.descuento_global_pct ?? 0);
          const rg = Number(c.recargo_global_pct ?? 0);
          const dgm = Number(c.descuento_global_monto ?? 0);
          const rgm = Number(c.recargo_global_monto ?? 0);
          if (dg <= 0 && rg <= 0 && dgm <= 0 && rgm <= 0) return null;
          const parts: string[] = [];
          if (dg > 0.0005) parts.push(`Desc. ${dg}%`);
          if (rg > 0.0005) parts.push(`Rec. ${rg}%`);
          if (dgm > 0.005) parts.push(`Desc. ${formatCurrency(dgm)}`);
          if (rgm > 0.005) parts.push(`Rec. ${formatCurrency(rgm)}`);
          return (
            <p className="text-xs text-muted-foreground">
              Ajuste sobre el total: {parts.join(' · ')}
            </p>
          );
        })()}
        {Number(c.imp_trib_comercial ?? 0) > 0.005 ? (
          <p className="text-xs text-muted-foreground">
            Otros tributos (comercial): {formatCurrency(Number(c.imp_trib_comercial))}
          </p>
        ) : null}
        {c.iva_monto > 0 ? (
          <>
            <p>
              Neto gravado: <span className="font-mono">{formatCurrency(c.subtotal)}</span>
            </p>
            <p>
              IVA ({c.iva_porcentaje}%) <span className="text-xs">(incluido)</span>:{' '}
              <span className="font-mono">{formatCurrency(c.iva_monto)}</span>
            </p>
          </>
        ) : (
          <p>
            Subtotal: <span className="font-mono">{formatCurrency(c.subtotal)}</span>
          </p>
        )}
        {Number(c.percepcion_iibb_monto ?? 0) > 0.005 ? (
          <p>
            Percepción IIBB:{' '}
            <span className="font-mono">{formatCurrency(Number(c.percepcion_iibb_monto))}</span>
          </p>
        ) : null}
        {Number(c.percepcion_iva_monto ?? 0) > 0.005 ? (
          <p>
            Percepción IVA:{' '}
            <span className="font-mono">{formatCurrency(Number(c.percepcion_iva_monto))}</span>
          </p>
        ) : null}
        {Number(c.impuesto_interno_monto ?? 0) > 0.005 ? (
          <p>
            Impuesto interno:{' '}
            <span className="font-mono">{formatCurrency(Number(c.impuesto_interno_monto))}</span>
          </p>
        ) : null}
        <p className="text-lg font-bold">
          {esVistaPresupuesto ? 'Total cotizado' : 'Total'}:{' '}
          <span className="font-mono">{formatCurrency(c.total)}</span>
        </p>
      </div>

      {c.notas ? (
        <div className="rounded-lg border bg-muted/30 p-3 text-sm">
          <p className="text-muted-foreground">Observaciones:</p>
          <p className="mt-1 whitespace-pre-wrap">{c.notas}</p>
        </div>
      ) : null}
      </div>
    </>
  );
}
