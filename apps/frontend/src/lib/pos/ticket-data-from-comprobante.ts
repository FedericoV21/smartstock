import type { TicketData } from '@/components/pos/ticket-termico';
import { ticketOcultarImportesDesdeDetallePago } from '@/lib/cuenta-corriente/ticket-ocultar-importes';
import type { EmisorTicketApi } from '@/lib/pos/fetch-pos-prefs';

const TZ_AR = 'America/Argentina/Buenos_Aires';

export type ComprobanteItemParaTicket = {
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
  promocion_descripcion?: string | null;
  descuento_promo_monto?: number | null;
  producto?: {
    nombre?: string;
    codigo?: string | null;
    iva_porcentaje?: number | null;
    unidad?: string;
    es_pesable?: boolean;
    codigo_barras?: string | null;
  } | null;
};

/**
 * Estructura mínima de detalle (GET /api/facturacion/[id]) para reimprimir el comprobante térmico
 * tal como en facturación/POS.
 */
export type ComprobanteParaTicket = {
  tipo: string;
  numero: number | null;
  /** Ticket por caja (POS): numeración local cuando `numero` fiscal es null. */
  numero_caja?: number | null;
  /** GET detalle enriquecido: «Caja 01 — …». */
  linea_caja_ticket?: string | null;
  fecha: string;
  subtotal: number;
  iva_monto: number;
  iva_porcentaje: number;
  total: number;
  total_mercaderia?: number | null;
  imp_trib_comercial?: number | null;
  descuento_global_monto?: number | null;
  recargo_global_monto?: number | null;
  financiacion_monto?: number | null;
  financiacion_descripcion?: string | null;
  metodo_pago?: string | null;
  metodo_pago_detalle?: unknown | null;
  cae: string | null;
  cae_vencimiento: string | null;
  punto_de_venta: number | null;
  arca_qr_url?: string | null;
  cliente: {
    nombre: string;
    razon_social: string | null;
  } | null;
  usuario?: { nombre: string; apellido: string | null } | null;
  items: ComprobanteItemParaTicket[];
};

function cajeroLegible(
  u: { nombre: string; apellido: string | null } | null | undefined,
): string | null {
  if (!u) return null;
  const n = `${u.nombre ?? ''} ${u.apellido ?? ''}`.trim();
  return n || null;
}

function metodoPagoLegible(c: ComprobanteParaTicket): string {
  const m = c.metodo_pago?.trim();
  if (!m) return '—';
  if (m === 'cuenta_corriente') return 'Cuenta corriente (pendiente)';
  if (m === 'mixto') return 'Pago mixto';
  if (m === 'transferencia_mp') return 'Transferencia MP';
  return m;
}

function unidadItemTicket(p: ComprobanteItemParaTicket['producto']): string | undefined {
  if (!p) return undefined;
  if (p.unidad === 'gramo' || p.es_pesable) return 'gramo';
  if (p.unidad && p.unidad !== 'unidad') return p.unidad;
  return undefined;
}

function promoSublinea(it: ComprobanteItemParaTicket): string | null {
  const dto = Number(it.descuento_promo_monto ?? 0);
  const desc = it.promocion_descripcion?.trim();
  if (dto > 0.005 && desc) {
    return `  ${desc}`;
  }
  if (desc) return `  ${desc}`;
  return null;
}

export function comprobanteDetalleATicketData(
  c: ComprobanteParaTicket,
  emisor: EmisorTicketApi,
  opts: { ivaDefault: number },
): TicketData {
  const ivaDef = Number.isFinite(opts.ivaDefault) ? opts.ivaDefault : 21;
  const fechaD = new Date(c.fecha);
  const fechaEmision = Number.isNaN(fechaD.getTime())
    ? '—'
    : fechaD.toLocaleDateString('es-AR', { timeZone: TZ_AR, day: '2-digit', month: '2-digit', year: '2-digit' });
  const horaEmision = Number.isNaN(fechaD.getTime())
    ? '—'
    : fechaD.toLocaleTimeString('es-AR', {
        timeZone: TZ_AR,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });

  const ahorroPromos =
    Math.round(
      c.items.reduce((s, it) => s + (Number(it.descuento_promo_monto) || 0), 0) * 100,
    ) / 100;

  const ncTicket =
    c.numero_caja != null && Number.isFinite(Number(c.numero_caja)) ? Number(c.numero_caja) : null;
  const numFiscal = c.numero != null && Number.isFinite(Number(c.numero)) ? Number(c.numero) : null;
  const numeroUi =
    numFiscal != null
      ? numFiscal
      : c.tipo === 'ticket' && ncTicket != null
        ? ncTicket
        : 0;
  const numeroTicketLabel =
    c.tipo === 'ticket' && numFiscal == null && ncTicket != null ? `Nº ${ncTicket}` : undefined;
  const lineaCajaStr =
    typeof c.linea_caja_ticket === 'string' && c.linea_caja_ticket.trim() !== ''
      ? c.linea_caja_ticket.trim()
      : null;

  const totMerc = c.total_mercaderia != null && Number(c.total_mercaderia) > 0.005
    ? Number(c.total_mercaderia)
    : null;
  const totalFinal = Number(c.total);
  const fin = Number(c.financiacion_monto ?? 0);
  const impTrib = Number(c.imp_trib_comercial) || 0;
  const usamosMerc = totMerc != null;
  const baseMerc = usamosMerc ? totMerc! : totalFinal;

  let ajusteMedioPagoMonto: number | undefined;
  let ajusteMedioPagoEtiqueta: string | undefined;
  if (usamosMerc) {
    if (Math.abs(fin) > 0.005) {
      ajusteMedioPagoMonto = fin;
      ajusteMedioPagoEtiqueta =
        (c.financiacion_descripcion && c.financiacion_descripcion.trim()) || 'Medio de pago';
    } else {
      const resto = Math.round((totalFinal - totMerc! - (impTrib > 0.005 ? impTrib : 0)) * 100) / 100;
      if (Math.abs(resto) > 0.005) {
        ajusteMedioPagoMonto = resto;
        ajusteMedioPagoEtiqueta = impTrib > 0.005 ? 'Tributos y forma de pago' : 'Ajuste (total vs. mercadería)';
      }
    }
  }

  const dgm = Number(c.descuento_global_monto ?? 0);
  const rgm = Number(c.recargo_global_monto ?? 0);

  const ocultarImportes = ticketOcultarImportesDesdeDetallePago(
    c.metodo_pago,
    c.metodo_pago_detalle,
  );

  return {
    tenantNombre: (emisor.nombre_ticket && emisor.nombre_ticket.trim()) || 'Nexus',
    logoUrl: emisor.logo_url ?? null,
    tenantCuit: emisor.cuit ?? undefined,
    tenantDomicilio: emisor.domicilio ?? undefined,
    tipoComprobante: c.tipo,
    numero: numeroUi,
    ...(numeroTicketLabel ? { numeroTicketLabel } : {}),
    ...(lineaCajaStr ? { lineaCaja: lineaCajaStr } : {}),
    fechaEmision,
    horaEmision,
    puntoVenta: c.punto_de_venta ?? null,
    cajeroNombre: cajeroLegible(c.usuario) ?? '—',
    ivaPorcentajeDefault: ivaDef,
    clienteNombre: (c.cliente?.razon_social && c.cliente.razon_social.trim()) ||
      (c.cliente?.nombre && c.cliente.nombre.trim()) || '—',
    items: c.items.map((it) => {
      const p = it.producto;
      return {
        nombre: p?.nombre && p.nombre.trim() ? p.nombre : 'Ítem',
        cantidad: it.cantidad,
        precio_unitario: it.precio_unitario,
        subtotal: it.subtotal,
        unidad: unidadItemTicket(p),
        iva_porcentaje: p?.iva_porcentaje ?? null,
        codigo_identificacion:
          (p?.codigo_barras && p.codigo_barras.trim()) || p?.codigo?.trim() || null,
        promo_sublinea: promoSublinea(it),
      };
    }),
    subtotal: c.subtotal,
    ivaMonto: c.iva_monto > 0 ? c.iva_monto : undefined,
    descuento: dgm > 0.005 ? dgm : undefined,
    recargo: rgm > 0.005 ? rgm : undefined,
    total: baseMerc,
    ...(ajusteMedioPagoMonto != null && ajusteMedioPagoEtiqueta
      ? {
          ajusteMedioPagoMonto,
          ajusteMedioPagoEtiqueta,
        }
      : {}),
    ahorroPromociones: ahorroPromos > 0.005 ? ahorroPromos : undefined,
    metodoPago: metodoPagoLegible(c),
    ...(ocultarImportes ? { ocultarImportes: true } : {}),
    qr_url: c.arca_qr_url && String(c.arca_qr_url).trim() ? c.arca_qr_url : null,
    cae: c.cae && String(c.cae).trim() ? String(c.cae).trim() : null,
    caeVencimiento: c.cae_vencimiento && String(c.cae_vencimiento).trim() ? c.cae_vencimiento : null,
  };
}
