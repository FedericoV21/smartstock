import { etiquetaMetodoPagoCierre } from '@/lib/caja/etiqueta-metodo-pago-cierre';
import type { CierreCajaTicketResumen } from '@/lib/caja/cierre-ticket-resumen';
import { formatCurrency, formatDate } from '@/lib/utils/formatters';

const TZ_AR = 'America/Argentina/Buenos_Aires';

export type CierreCajaTicketMeta = {
  tenantNombre: string;
  logoUrl?: string | null;
  tenantCuit?: string | null;
  tenantDomicilio?: string | null;
  cajaEtiqueta?: string | null;
  cajeroNombre?: string | null;
};

export function printCierreCajaTicket(
  resumen: CierreCajaTicketResumen,
  meta: CierreCajaTicketMeta,
  ancho: '80mm' | '57mm' = '80mm',
): boolean {
  const printWindow = window.open('', '_blank', 'width=400,height=600');
  if (!printWindow) return false;

  printWindow.document.write(buildCierreCajaTicketHTML(resumen, meta, ancho));
  printWindow.document.close();
  printWindow.focus();
  const delay = meta.logoUrl?.trim() ? 700 : 300;
  window.setTimeout(() => {
    printWindow.print();
    printWindow.close();
  }, delay);
  return true;
}

export function buildCierreCajaTicketHTML(
  resumen: CierreCajaTicketResumen,
  meta: CierreCajaTicketMeta,
  ancho: '80mm' | '57mm' = '80mm',
): string {
  const width = ancho === '80mm' ? '302px' : '215px';
  const fontSize = ancho === '80mm' ? '12px' : '10px';
  const logoMaxH = ancho === '80mm' ? '52px' : '40px';
  const arq = resumen.arqueo_efectivo;
  const snapshot = resumen.snapshot;
  const caja = meta.cajaEtiqueta?.trim() || cajaIdLegible(resumen.caja_id);
  const logoBlock = meta.logoUrl?.trim()
    ? `<div class="center" style="margin:2px 0 6px"><img src="${escapeAttr(
        meta.logoUrl.trim(),
      )}" alt="" style="max-width:100%;max-height:${logoMaxH};object-fit:contain" /></div>`
    : '';
  const gastosItems = resumen.gastos_items ?? [];
  const totalGastos = arq?.gastos_monto ?? gastosItems.reduce((sum, item) => sum + Number(item.monto || 0), 0);
  const esperadoFinal = arq?.esperado_ajustado ?? snapshot.efectivo_esperado - totalGastos;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @page { margin: 0; size: ${width} auto; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Courier New', Courier, monospace;
      font-size: ${fontSize};
      font-weight: 700;
      width: ${width};
      padding: 6px 4px;
      color: #000;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      text-shadow: 0.35px 0 0 #000, -0.35px 0 0 #000;
    }
    .center { text-align: center; }
    .sep { border: none; border-top: 2px solid #000; margin: 6px 0; height: 0; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 1px 0; vertical-align: top; }
    td:last-child { text-align: right; padding-left: 8px; white-space: nowrap; }
    .total td { font-size: 1.12em; padding-top: 4px; }
    .small { font-size: 0.92em; line-height: 1.25; }
  </style>
</head>
<body>
  ${logoBlock}
  <div class="center" style="font-size:1.15em;margin-bottom:2px">${escapeHtml(meta.tenantNombre || 'Smart Stock')}</div>
  ${meta.tenantDomicilio?.trim() ? `<div class="center small">${escapeHtml(meta.tenantDomicilio.trim())}</div>` : ''}
  ${meta.tenantCuit?.trim() ? `<div class="center small">CUIT: ${escapeHtml(meta.tenantCuit.trim())}</div>` : ''}
  <div class="sep"></div>
  <div class="center" style="margin-bottom:4px">CIERRE DE CAJA</div>
  <div class="small">Caja: ${escapeHtml(caja)}</div>
  ${meta.cajeroNombre?.trim() ? `<div class="small">Cajero/a: ${escapeHtml(meta.cajeroNombre.trim())}</div>` : ''}
  <div class="small">Fecha operativa: ${escapeHtml(formatDate(resumen.fecha_operativa))}</div>
  <div class="small">Emitido: ${escapeHtml(formatDateTimeAr(resumen.created_at))}</div>
  <div class="small">Periodo: ${escapeHtml(formatDateTimeAr(resumen.rango_desde))} &ndash; ${escapeHtml(
    formatDateTimeAr(resumen.rango_hasta),
  )}</div>
  <div class="sep"></div>
  <table>
    ${row('Comprobantes', String(snapshot.total_comprobantes))}
    ${row('Ventas netas', formatCurrency(snapshot.ventas_netas))}
    ${row('Pagos cta. cte.', formatCurrency(snapshot.pagos_cta_cte_total))}
  </table>
  ${
    snapshot.medios.length
      ? `<div class="sep"></div>
  <div class="center small">MEDIOS DE PAGO</div>
  <table>
    ${snapshot.medios
      .map((m) =>
        row(
          `${etiquetaMetodoPagoCierre(m.metodo_pago)} (${m.cantidad_comprobantes})`,
          formatCurrency(Number(m.monto_neto)),
        ),
      )
      .join('')}
  </table>`
      : ''
  }
  <div class="sep"></div>
  <table>
    ${row('Fondo inicial', formatCurrency(snapshot.fondo_apertura ?? 0))}
    ${row('Efectivo ventas', formatCurrency(snapshot.efectivo_ventas_periodo ?? 0))}
    ${
      (snapshot.efectivo_cobros_cc_manual ?? 0) > 0
        ? row('Cobros efectivo CC', formatCurrency(snapshot.efectivo_cobros_cc_manual ?? 0))
        : ''
    }
    ${row('Efectivo sistema', formatCurrency(snapshot.efectivo_esperado))}
    ${totalGastos > 0 ? row('Gastos', `-${formatCurrency(totalGastos)}`) : ''}
    ${row('Esperado final', formatCurrency(esperadoFinal), 'total')}
    ${arq ? row('Contado', formatCurrency(arq.contado), 'total') : ''}
    ${arq ? row('Diferencia', formatCurrency(arq.diferencia), 'total') : ''}
  </table>
  ${
    gastosItems.length
      ? `<div class="sep"></div>
  <div class="center small">GASTOS</div>
  <table>
    ${gastosItems.map((g) => row(g.concepto, formatCurrency(Number(g.monto)))).join('')}
  </table>`
      : arq?.gastos_detalle
        ? `<div class="sep"></div><div class="small">Gastos: ${escapeHtml(arq.gastos_detalle)}</div>`
        : ''
  }
  <div class="sep"></div>
  <div class="center small">Resumen interno de movimientos</div>
  <div class="center small">Nexus POS</div>
</body>
</html>`;
}

function row(label: string, value: string, className = ''): string {
  const cls = className ? ` class="${escapeAttr(className)}"` : '';
  return `<tr${cls}><td>${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`;
}

function cajaIdLegible(cajaId: string): string {
  const id = String(cajaId ?? '').trim();
  if (!id || id === '__sin_caja__') return 'Sin caja';
  return id;
}

function formatDateTimeAr(value: string): string {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return value;
  return d.toLocaleString('es-AR', {
    timeZone: TZ_AR,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
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
