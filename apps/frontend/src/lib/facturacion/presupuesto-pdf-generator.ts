import jsPDF from 'jspdf';

import { formatCurrency, formatDate } from '@/lib/utils/formatters';
import { medirYdibujarLogoEmisor } from '@/lib/facturacion/pdf-emisor-logo';
import { formatearNumeroComprobanteAfip } from './formato';
import type { DatosCliente, DatosComprobante, DatosEmisor, ItemPDF } from './pdf-generator';

const GRAY_MUTED: [number, number, number] = [136, 136, 136];
const BAND_FILL: [number, number, number] = [245, 245, 245];
const CLIENT_FILL: [number, number, number] = [250, 250, 250];
const ROW_ALT: [number, number, number] = [248, 248, 248];

const CONDICION_IVA_AFIP: Record<string, string> = {
  responsable_inscripto: 'IVA Responsable Inscripto',
  monotributista: 'Responsable Monotributo',
  exento: 'Exento',
  consumidor_final: 'Consumidor final',
};

function formatCondicionIvaAfip(condicion: string): string {
  return CONDICION_IVA_AFIP[condicion] ?? condicion;
}

function formatNumeroEs(n: number, decimals = 2): string {
  return n.toLocaleString('es-AR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function notaAjusteManualItem(item: ItemPDF): string | null {
  const d = item.descuento_manual_pct ?? 0;
  const r = item.recargo_manual_pct ?? 0;
  if (d <= 0.0005 && r <= 0.0005) return null;
  const parts: string[] = [];
  if (d > 0.0005) parts.push(`desc. ${formatNumeroEs(d, 2)}%`);
  if (r > 0.0005) parts.push(`rec. ${formatNumeroEs(r, 2)}%`);
  return parts.join(' · ');
}

function ivaComponenteEstimadoItem(item: ItemPDF): number {
  if (item.iva_monto != null && item.iva_monto > 0) {
    return item.iva_monto;
  }
  const r = item.iva_porcentaje;
  if (r == null || r <= 0) return 0;
  return Math.round(((item.subtotal * r) / (100 + r)) * 100) / 100;
}

/** Label bold + valor normal, fontSize 9, ancho de bloque fijo. */
function textoEtiquetaValorCliente(
  doc: jsPDF,
  y: number,
  x: number,
  anchoValor: number,
  etiqueta: string,
  valor: string,
): number {
  const lh = 3.6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  const labelLines = doc.splitTextToSize(`${etiqueta}:`, anchoValor);
  doc.text(labelLines, x, y);
  const labelH = labelLines.length * lh;
  doc.setFont('helvetica', 'normal');
  const lineas = doc.splitTextToSize(valor, anchoValor);
  const yVal = y + labelH;
  doc.text(lineas, x, yVal);
  return yVal + lineas.length * 3.6 + 1.2;
}

/** Solo splitTextToSize (no dibuja) para calcular altura de la caja cliente. */
function alturaBloqueClienteMm(
  doc: jsPDF,
  receptorNombre: string,
  cliente: DatosCliente,
  anchoCli: number,
  pad: number,
): number {
  const lh = 3.6;
  /** Igual que título "Datos del cliente" (y+3.5) + y += 8 antes del primer campo. */
  let h = pad + 8;

  const campo = (etiqueta: string, valor: string) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    h += doc.splitTextToSize(`${etiqueta}:`, anchoCli).length * lh;
    doc.setFont('helvetica', 'normal');
    h += doc.splitTextToSize(valor, anchoCli).length * lh + 1.2;
  };

  campo('Nombre o razón social', receptorNombre);
  campo('CUIT / DNI', cliente.cuit_dni?.trim() || '—');
  campo('Condición frente al IVA', formatCondicionIvaAfip(cliente.condicion_iva));
  campo('Domicilio', cliente.direccion?.trim() || '—');

  return h + pad;
}

/**
 * PDF de presupuesto: cotización (sin réplica de factura AFIP).
 */
export function generarPDFPresupuestoDetallado(
  emisor: DatosEmisor,
  cliente: DatosCliente,
  comprobante: DatosComprobante,
  items: ItemPDF[],
): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;
  const innerRight = pageWidth - margin;
  const contentW = innerRight - margin;

  const emisorNombre = emisor.razon_social || emisor.nombre;
  const receptorNombre = cliente.razon_social || cliente.nombre;
  const nroPresupuesto = formatearNumeroComprobanteAfip(comprobante.numero);
  const fechaStr = formatDate(comprobante.fecha);
  const umDefault = 'unidades';

  const bandH = 3;
  doc.setFillColor(BAND_FILL[0], BAND_FILL[1], BAND_FILL[2]);
  doc.rect(0, 0, pageWidth, bandH, 'F');
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(GRAY_MUTED[0], GRAY_MUTED[1], GRAY_MUTED[2]);
  doc.text('Cotización formal · Sin validez fiscal · No es factura', pageWidth / 2, 2.2, {
    align: 'center',
  });
  doc.setTextColor(0, 0, 0);

  /** Misma franja: logo a la izquierda, título a la derecha (sin superponerse). */
  const rowYTop = bandH + 2;
  const logoBox = medirYdibujarLogoEmisor(doc, emisor.logo_data_url, margin, rowYTop);

  doc.setFontSize(28);
  doc.setFont('helvetica', 'bold');
  let yLine: number;
  if (logoBox) {
    const rowH = Math.max(logoBox.height, 11) + 3;
    const titleBaseline = rowYTop + rowH - 2.5;
    doc.text('PRESUPUESTO', innerRight, titleBaseline, { align: 'right' });
    yLine = rowYTop + rowH + 2;
  } else {
    const yTitle = bandH + 13;
    doc.text('PRESUPUESTO', margin, yTitle);
    yLine = yTitle + 9;
  }

  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(1);
  doc.line(margin, yLine, innerRight, yLine);
  let y = yLine + 8;

  const colSplit = margin + contentW * 0.55;
  let yEm = y;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(emisorNombre, margin, yEm);
  yEm += 5.2;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  if (emisor.cuit) {
    doc.text(`CUIT: ${emisor.cuit}`, margin, yEm);
    yEm += 4.2;
  }
  if (emisor.domicilio) {
    const domLines = doc.splitTextToSize(emisor.domicilio, colSplit - margin - 4);
    doc.text(domLines, margin, yEm);
    yEm += domLines.length * 4;
  }
  doc.text(`Condición IVA: ${formatCondicionIvaAfip(emisor.condicion_iva)}`, margin, yEm);
  yEm += 4.2;

  let yMeta = y;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(GRAY_MUTED[0], GRAY_MUTED[1], GRAY_MUTED[2]);
  doc.text('Número de presupuesto', innerRight, yMeta, { align: 'right' });
  doc.setTextColor(0, 0, 0);
  yMeta += 4;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(nroPresupuesto, innerRight, yMeta, { align: 'right' });
  yMeta += 6.5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Fecha de emisión: ${fechaStr}`, innerRight, yMeta, { align: 'right' });
  yMeta += 5;

  y = Math.max(yEm, yMeta) + 3;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);
  doc.line(margin, y, innerRight, y);
  y += 6;

  const padCliente = 4;
  const innerLeft = margin + padCliente;
  const anchoCli = contentW - 2 * padCliente;
  const boxClienteTop = y;
  const boxClienteH = alturaBloqueClienteMm(doc, receptorNombre, cliente, anchoCli, padCliente);

  doc.setLineWidth(0.3);
  doc.setDrawColor(0, 0, 0);
  doc.setFillColor(CLIENT_FILL[0], CLIENT_FILL[1], CLIENT_FILL[2]);
  doc.rect(margin, boxClienteTop, contentW, boxClienteH, 'FD');

  y = boxClienteTop + padCliente;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Datos del cliente', innerLeft, y + 3.5);
  y += 8;
  doc.setFont('helvetica', 'normal');
  y = textoEtiquetaValorCliente(doc, y, innerLeft, anchoCli, 'Nombre o razón social', receptorNombre);
  y = textoEtiquetaValorCliente(
    doc,
    y,
    innerLeft,
    anchoCli,
    'CUIT / DNI',
    cliente.cuit_dni?.trim() || '—',
  );
  y = textoEtiquetaValorCliente(
    doc,
    y,
    innerLeft,
    anchoCli,
    'Condición frente al IVA',
    formatCondicionIvaAfip(cliente.condicion_iva),
  );
  y = textoEtiquetaValorCliente(
    doc,
    y,
    innerLeft,
    anchoCli,
    'Domicilio',
    cliente.direccion?.trim() || '—',
  );

  y = boxClienteTop + boxClienteH + 6;

  const wCod = 16;
  const wCant = 14;
  const wUm = 14;
  const wPu = 24;
  const wIvaP = 13;
  const wIvaImp = 20;
  const wSub = 24;
  const wDesc = contentW - wCod - wCant - wUm - wPu - wIvaP - wIvaImp - wSub;

  const xCod = margin;
  const xDesc = xCod + wCod;
  const xCant = xDesc + wDesc;
  const xUm = xCant + wCant;
  const xPu = xUm + wUm;
  const xIvaP = xPu + wPu;
  const xIvaImp = xIvaP + wIvaP;
  const xSub = xIvaImp + wIvaImp;

  const headerRowH = 7;
  const colWidths = [wCod, wDesc, wCant, wUm, wPu, wIvaP, wIvaImp, wSub];

  function dibujarEncabezadoTabla(yy: number) {
    doc.setFillColor(0, 0, 0);
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.3);
    doc.rect(margin, yy, contentW, headerRowH, 'FD');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('Cód.', xCod + 0.5, yy + 4.7);
    doc.text('Descripción', xDesc + 0.5, yy + 4.7);
    doc.text('Cant.', xCant + wCant - 0.5, yy + 4.7, { align: 'right' });
    doc.text('Unid.', xUm + wUm - 0.5, yy + 4.7, { align: 'right' });
    doc.text('P. unit.', xPu + wPu - 0.5, yy + 4.7, { align: 'right' });
    doc.text('IVA %', xIvaP + wIvaP - 0.5, yy + 4.7, { align: 'right' });
    doc.text('IVA incl.*', xIvaImp + wIvaImp - 0.5, yy + 4.7, { align: 'right' });
    doc.text('Subtotal', xSub + wSub - 0.5, yy + 4.7, { align: 'right' });
    let vx = margin;
    for (const w of colWidths) {
      vx += w;
      doc.setDrawColor(40, 40, 40);
      doc.line(vx, yy, vx, yy + headerRowH);
    }
    doc.setDrawColor(0, 0, 0);
    doc.setTextColor(0, 0, 0);
  }

  dibujarEncabezadoTabla(y);
  y += headerRowH;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setDrawColor(200, 200, 200);

  function drawRowBottom(yy: number, rowH: number) {
    doc.setDrawColor(210, 210, 210);
    doc.setLineWidth(0.2);
    doc.line(margin, yy + rowH, innerRight, yy + rowH);
  }

  items.forEach((item, rowIdx) => {
    const codStr = (item.codigo ?? '').trim() || '—';
    const descLines = doc.splitTextToSize(item.descripcion, wDesc - 1);
    const tieneNotaPromoPu =
      item.precio_unitario_efectivo != null &&
      Math.abs(item.precio_unitario_efectivo - item.precio_unitario) > 0.0005;
    const notaMan = notaAjusteManualItem(item);
    const rowH =
      Math.max(descLines.length * 3.35, 5.5) +
      (tieneNotaPromoPu ? 3.4 : 0) +
      (notaMan ? 3.2 : 0);

    const footerReserve = 52;
    if (y + rowH > pageHeight - footerReserve) {
      doc.addPage();
      y = margin;
      dibujarEncabezadoTabla(y);
      y += headerRowH;
    }

    const rowTop = y;
    const fillRgb = rowIdx % 2 === 0 ? ROW_ALT : ([255, 255, 255] as const);
    doc.setFillColor(fillRgb[0], fillRgb[1], fillRgb[2]);
    doc.rect(margin, rowTop, contentW, rowH, 'F');

    drawRowBottom(rowTop, rowH);
    let vx = margin;
    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.15);
    for (const w of colWidths) {
      vx += w;
      doc.line(vx, rowTop, vx, rowTop + rowH);
    }
    doc.setDrawColor(100, 100, 100);
    doc.setLineWidth(0.2);
    doc.line(margin, rowTop, margin, rowTop + rowH);
    doc.line(innerRight, rowTop, innerRight, rowTop + rowH);

    const yyText = rowTop + 4.2;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(0, 0, 0);
    doc.text(codStr, xCod + 0.5, yyText);
    doc.text(descLines, xDesc + 0.5, yyText);

    const qtyStr = item.cantidad.toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    doc.text(qtyStr, xCant + wCant - 0.5, yyText, { align: 'right' });
    doc.text(item.unidad_medida ?? umDefault, xUm + wUm - 0.5, yyText, {
      align: 'right',
    });

    const puXRight = xPu + wPu - 0.5;
    if (tieneNotaPromoPu) {
      const puStr = formatCurrency(item.precio_unitario);
      doc.text(puStr, puXRight, yyText, { align: 'right' });
      const tw = doc.getTextWidth(puStr);
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.35);
      const strikeY = yyText - 1.1;
      doc.line(puXRight - tw, strikeY, puXRight, strikeY);
      let yPuNote = yyText + 3.2;
      doc.setFontSize(7);
      doc.setTextColor(GRAY_MUTED[0], GRAY_MUTED[1], GRAY_MUTED[2]);
      doc.text(
        `(c/promo: ${formatCurrency(item.precio_unitario_efectivo!)})`,
        puXRight,
        yPuNote,
        { align: 'right' },
      );
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(7);
      yPuNote += 3.1;
      if (notaMan) {
        doc.setFontSize(6.5);
        doc.text(`(${notaMan})`, puXRight, yPuNote, { align: 'right' });
        doc.setFontSize(7);
      }
    } else {
      doc.text(formatCurrency(item.precio_unitario), puXRight, yyText, { align: 'right' });
      if (notaMan) {
        doc.setFontSize(6.5);
        doc.text(`(${notaMan})`, puXRight, yyText + 3.1, { align: 'right' });
        doc.setFontSize(7);
      }
    }

    const rate = item.iva_porcentaje;
    const ivaComp = ivaComponenteEstimadoItem(item);
    doc.text(rate != null && rate > 0 ? `${rate}%` : '—', xIvaP + wIvaP - 0.5, yyText, {
      align: 'right',
    });
    doc.text(ivaComp > 0 ? formatCurrency(ivaComp) : '—', xIvaImp + wIvaImp - 0.5, yyText, {
      align: 'right',
    });
    doc.text(formatCurrency(item.subtotal), xSub + wSub - 0.5, yyText, {
      align: 'right',
    });

    y = rowTop + rowH;
  });

  y += 4;

  doc.setFontSize(7);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(GRAY_MUTED[0], GRAY_MUTED[1], GRAY_MUTED[2]);
  doc.text(
    '* Componente de IVA incluido en el precio unitario (referencia, precios finales IVA incluido).',
    margin,
    y,
  );
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'normal');
  y += 7;

  const sumIvaEst = items.reduce((s, it) => s + ivaComponenteEstimadoItem(it), 0);
  const totX = innerRight;

  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);
  doc.line(margin, y, innerRight, y);
  y += 5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  if (sumIvaEst > 0.005) {
    const t1 = `Suma IVA incluido en precios (referencia): ${formatCurrency(sumIvaEst)}`;
    doc.text(t1, totX, y, { align: 'right' });
    y += 5.5;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  const t2 = `Total de la cotización: ${formatCurrency(comprobante.total)}`;
  doc.text(t2, totX, y, { align: 'right' });
  y += 10;

  doc.setLineWidth(0.2);
  doc.line(margin, y, innerRight, y);
  y += 4;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const legal = doc.splitTextToSize(
    'Este documento es una cotización y no reemplaza una factura ni comprobante fiscal. ' +
      'Precios, plazos de entrega y disponibilidad quedan sujetos a confirmación al aceptar el pedido.',
    contentW,
  );
  doc.text(legal, margin, y);
  y += legal.length * 3.6;

  if (comprobante.notas?.trim()) {
    y += 4;
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    const obs = doc.splitTextToSize(`Observaciones: ${comprobante.notas.trim()}`, contentW);
    doc.text(obs, margin, y);
    y += obs.length * 3.5;
    doc.setFont('helvetica', 'normal');
  }

  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.text(`Pág. 1/${doc.getNumberOfPages()}`, innerRight, pageHeight - 8, {
    align: 'right',
  });

  return doc;
}
