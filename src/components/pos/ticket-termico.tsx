'use client';

import { useEffect, useRef } from 'react';

import { formatCurrency } from '@/lib/utils/formatters';

const TZ_AR = 'America/Argentina/Buenos_Aires';

interface TicketItem {
  nombre: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
  unidad?: string;
  iva_porcentaje?: number | null;
  /** Código de barras o SKU debajo del ítem (como en ticket supermercado). */
  codigo_identificacion?: string | null;
}

export interface TicketData {
  tenantNombre: string;
  logoUrl?: string | null;
  tenantCuit?: string;
  tenantDomicilio?: string;
  tipoComprobante: string;
  numero: number;
  /** Fecha corta (ej. dd/mm/aa) para bloque P.V. / hora */
  fechaEmision?: string;
  /** Hora (ej. HH:mm:ss) */
  horaEmision?: string;
  /** Fallback si no hay fechaEmision/horaEmision */
  fecha?: string;
  puntoVenta?: number | null;
  cajeroNombre?: string | null;
  clienteNombre: string;
  items: TicketItem[];
  subtotal: number;
  descuento?: number;
  ivaMonto?: number;
  total: number;
  metodoPago: string;
  vuelto?: number;
  cae?: string | null;
  caeVencimiento?: string | null;
  /** Si el ítem no tiene `iva_porcentaje`, se usa este valor (típico: `tenant.iva_porcentaje_default`). */
  ivaPorcentajeDefault?: number;
}

interface Props {
  data: TicketData;
  ancho?: '80mm' | '57mm';
  autoPrint?: boolean;
  onPrinted?: () => void;
}

export function TicketTermico({ data, ancho = '80mm', autoPrint = false, onPrinted }: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!autoPrint || !frameRef.current) return;
    const timer = setTimeout(() => {
      frameRef.current?.contentWindow?.print();
      onPrinted?.();
    }, 300);
    return () => clearTimeout(timer);
  }, [autoPrint, onPrinted]);

  const anchoPixels = ancho === '80mm' ? '302px' : '215px';
  const fontSize = ancho === '80mm' ? '12px' : '10px';

  const html = buildTicketHTML(data, anchoPixels, fontSize);

  return (
    <iframe
      ref={frameRef}
      srcDoc={html}
      className="hidden"
      title="Ticket térmico"
    />
  );
}

export function printTicket(data: TicketData, ancho: '80mm' | '57mm' = '80mm') {
  const anchoPixels = ancho === '80mm' ? '302px' : '215px';
  const fontSize = ancho === '80mm' ? '12px' : '10px';
  const html = buildTicketHTML(data, anchoPixels, fontSize);

  const printWindow = window.open('', '_blank', 'width=400,height=600');
  if (!printWindow) return;

  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  const delay = data.logoUrl ? 700 : 300;
  setTimeout(() => {
    printWindow.print();
    printWindow.close();
  }, delay);
}

function buildTicketHTML(data: TicketData, ancho: string, fontSize: string): string {
  const tipoLabel =
    data.tipoComprobante === 'ticket'
      ? 'TICKET'
      : data.tipoComprobante.replace('_', ' ').toUpperCase();

  const logoMaxH = ancho === '302px' ? '52px' : '40px';

  const logoBlock =
    data.logoUrl && data.logoUrl.trim()
      ? `<div class="center" style="margin:2px 0 6px"><img class="ticket-logo" src="${escapeAttr(
          data.logoUrl.trim(),
        )}" alt="" style="max-width:100%;max-height:${logoMaxH};object-fit:contain" /></div>`
      : '';

  const { fechaEmision, horaEmision } = resolveFechaHora(data);

  const pv = data.puntoVenta != null ? String(data.puntoVenta) : '—';
  const nroComp = String(data.numero);
  const cajero = data.cajeroNombre?.trim() || '—';

  const ivaDef = data.ivaPorcentajeDefault ?? 21;

  const itemsHtml = data.items
    .map((it) => {
      const name = escapeHtml(it.nombre.toLocaleUpperCase('es-AR'));
      const qty = formatTicketCantidad(it.cantidad, it.unidad);
      const pu = formatCurrency(it.precio_unitario);
      const ivaRaw = it.iva_porcentaje;
      const ivaEfectivo =
        ivaRaw != null && Number.isFinite(Number(ivaRaw)) ? Number(ivaRaw) : ivaDef;
      const ivaTxt = formatIvaParenthesis(ivaEfectivo);
      const st = formatCurrency(it.subtotal);
      const code = it.codigo_identificacion?.trim();
      const codeLine = code
        ? `<div style="font-size:0.9em;margin-top:2px;letter-spacing:0.02em">${escapeHtml(code)}</div>`
        : '';
      return `<div class="item-block" style="margin-bottom:8px">
  <div style="text-align:left;font-weight:bold;line-height:1.2">${name}</div>
  <table style="width:100%;margin-top:3px;border-collapse:collapse"><tr>
    <td style="text-align:left;padding:0;vertical-align:baseline">${qty} x ${pu} ${ivaTxt}</td>
    <td style="text-align:right;padding:0 0 0 6px;white-space:nowrap;vertical-align:baseline">${st}</td>
  </tr></table>
  ${codeLine}
</div>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @page { margin: 0; size: ${ancho} auto; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Courier New', Courier, monospace;
      font-size: ${fontSize};
      width: ${ancho};
      padding: 6px 4px;
      color: #000;
    }
    .center { text-align: center; }
    .bold { font-weight: bold; }
    .sep { border: none; border-top: 1px dashed #000; margin: 6px 0; height: 0; }
    table { border-collapse: collapse; }
    .total-row td { font-weight: bold; font-size: 1.15em; padding-top: 4px; }
  </style>
</head>
<body>
  ${logoBlock}
  <div class="center bold" style="font-size:1.15em;margin-bottom:2px">${escapeHtml(data.tenantNombre)}</div>
  ${data.tenantDomicilio ? `<div>${escapeHtml(data.tenantDomicilio)}</div>` : ''}
  ${data.tenantCuit ? `<div>CUIT: ${escapeHtml(data.tenantCuit)}</div>` : ''}
  <div class="sep"></div>
  <div class="center bold" style="margin-bottom:4px">${tipoLabel}</div>
  <table style="width:100%;margin-bottom:4px">
    <tr>
      <td style="width:50%;vertical-align:top">P.V. Nro: ${escapeHtml(pv)}</td>
      <td style="width:50%;text-align:right;vertical-align:top">Nro: ${escapeHtml(nroComp)}</td>
    </tr>
    <tr>
      <td style="vertical-align:top">${escapeHtml(fechaEmision)}</td>
      <td style="text-align:right;vertical-align:top">${escapeHtml(horaEmision)}</td>
    </tr>
    <tr>
      <td style="vertical-align:top;padding-top:2px" colspan="2">Cajero/a: ${escapeHtml(cajero)}</td>
    </tr>
  </table>
  <div>Cliente: ${escapeHtml(data.clienteNombre)}</div>
  <div class="sep"></div>
  ${itemsHtml}
  <div class="sep"></div>
  <table style="width:100%">
    <tr>
      <td>Subtotal</td>
      <td style="text-align:right">${formatCurrency(data.subtotal)}</td>
    </tr>
    ${data.descuento && data.descuento > 0 ? `<tr><td>Descuento</td><td style="text-align:right">-${formatCurrency(data.descuento)}</td></tr>` : ''}
    ${data.ivaMonto && data.ivaMonto > 0 ? `<tr><td>IVA (incluido)</td><td style="text-align:right">${formatCurrency(data.ivaMonto)}</td></tr>` : ''}
    <tr class="total-row">
      <td>TOTAL</td>
      <td style="text-align:right">${formatCurrency(data.total)}</td>
    </tr>
  </table>
  <div class="sep"></div>
  <div>Método de pago: ${escapeHtml(data.metodoPago)}</div>
  ${data.vuelto && data.vuelto > 0 ? `<div class="bold">Vuelto: ${formatCurrency(data.vuelto)}</div>` : ''}
  ${data.cae ? `<div class="sep"></div><div>CAE: ${escapeHtml(data.cae)}</div>` : ''}
  ${data.caeVencimiento ? `<div>Vto. CAE: ${escapeHtml(data.caeVencimiento)}</div>` : ''}
  <div class="sep"></div>
  <div class="center" style="margin-top:4px">¡Gracias por su compra!</div>
  <div class="center" style="font-size:0.85em;margin-top:2px">Nexus POS</div>
</body>
</html>`;
}

function resolveFechaHora(data: TicketData): { fechaEmision: string; horaEmision: string } {
  if (data.fechaEmision && data.horaEmision) {
    return { fechaEmision: data.fechaEmision, horaEmision: data.horaEmision };
  }
  const now = new Date();
  return {
    fechaEmision: now.toLocaleDateString('es-AR', {
      timeZone: TZ_AR,
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
    }),
    horaEmision: now.toLocaleTimeString('es-AR', {
      timeZone: TZ_AR,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }),
  };
}

function formatTicketCantidad(q: number, unidad?: string): string {
  const n = Number(q);
  if (!Number.isFinite(n)) return '0';
  if (unidad === 'gramo') {
    return String(Math.round(n));
  }
  if (unidad && unidad !== 'unidad') {
    const rounded = Math.round(n * 1000) / 1000;
    if (Math.abs(rounded - Math.round(rounded)) < 1e-9) return String(Math.round(rounded));
    return rounded.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
  }
  if (Number.isInteger(n) || Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
  return n.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

function formatIvaParenthesis(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return '(—)';
  const n = Number(value);
  const t = n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `(${t}%)`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
