import jsPDF from 'jspdf';

import { formatCurrency, formatDate } from '@/lib/utils/formatters';
import {
  codigoAfipComprobante,
  formatearNumeroComprobanteAfip,
  formatearPuntoVentaAfip,
} from './formato';

export interface DatosEmisor {
  nombre: string;
  razon_social: string | null;
  cuit: string | null;
  domicilio: string | null;
  condicion_iva: string;
  punto_de_venta: number;
  ingresos_brutos?: string | null;
  fecha_inicio_actividades?: string | null;
}

export interface DatosCliente {
  nombre: string;
  razon_social: string | null;
  cuit_dni: string | null;
  condicion_iva: string;
  direccion: string | null;
}

export interface ItemPDF {
  cantidad: number;
  descripcion: string;
  precio_unitario: number;
  subtotal: number;
  iva_porcentaje?: number | null;
  iva_monto?: number;
  codigo?: string | null;
  unidad_medida?: string | null;
}

export interface DatosComprobante {
  tipo: string;
  numero: number;
  fecha: string;
  subtotal: number;
  iva_monto: number;
  iva_porcentaje: number;
  total: number;
  notas: string | null;
  cae: string | null;
  cae_vencimiento: string | null;
  total_mercaderia?: number | null;
  financiacion_monto?: number | null;
  financiacion_porcentaje?: number | null;
  financiacion_descripcion?: string | null;
  condicion_venta?: string | null;
  periodo_facturado_desde?: string | null;
  periodo_facturado_hasta?: string | null;
  fecha_vencimiento_pago?: string | null;
  importe_otros_tributos?: number | null;
  copia?: 'ORIGINAL' | 'DUPLICADO' | 'TRIPLICADO';
}

const CONDICION_IVA_AFIP: Record<string, string> = {
  responsable_inscripto: 'IVA Responsable Inscripto',
  monotributista: 'Responsable Monotributo',
  exento: 'Exento',
  consumidor_final: 'Consumidor final',
};

function formatCondicionIvaAfip(condicion: string): string {
  return CONDICION_IVA_AFIP[condicion] ?? condicion;
}

function letraComprobante(tipo: string): string {
  if (tipo.includes('_a')) return 'A';
  if (tipo.includes('_b')) return 'B';
  if (tipo.includes('_c')) return 'C';
  return 'X';
}

function tituloComprobante(tipo: string): string {
  if (tipo.startsWith('nota_credito')) return 'NOTA DE CRÉDITO';
  if (tipo === 'remito') return 'REMITO';
  if (tipo === 'presupuesto') return 'PRESUPUESTO';
  if (tipo === 'ticket') return 'TICKET';
  return 'FACTURA';
}

/** Número sin prefijo $ para columnas % (estilo comprobante papel). */
function formatNumeroEs(n: number, decimals = 2): string {
  return n.toLocaleString('es-AR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Etiqueta (puede partirse en varias líneas) y valor debajo, mismo ancho de bloque. */
function textoEtiquetaValor(
  doc: jsPDF,
  y: number,
  x: number,
  anchoValor: number,
  etiqueta: string,
  valor: string,
): number {
  const lh = 3.4;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  const labelLines = doc.splitTextToSize(`${etiqueta}:`, anchoValor);
  doc.text(labelLines, x, y);
  const labelH = labelLines.length * lh;
  doc.setFont('helvetica', 'normal');
  const lineas = doc.splitTextToSize(valor, anchoValor);
  const yVal = y + labelH;
  doc.text(lineas, x, yVal);
  return yVal + lineas.length * 3.5 + 1.5;
}

export function generarPDF(
  emisor: DatosEmisor,
  cliente: DatosCliente,
  comprobante: DatosComprobante,
  items: ItemPDF[],
): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 10;
  const innerRight = pageWidth - margin;
  const contentW = innerRight - margin;
  let y = margin;

  const letra = letraComprobante(comprobante.tipo);
  const tipoTitulo = tituloComprobante(comprobante.tipo);
  const codAfip = codigoAfipComprobante(comprobante.tipo);
  const pvStr = formatearPuntoVentaAfip(emisor.punto_de_venta);
  const nroStr = formatearNumeroComprobanteAfip(comprobante.numero);
  const copiaLabel = comprobante.copia ?? 'ORIGINAL';

  const fechaEmision = formatDate(comprobante.fecha);
  const periodoDesde = formatDate(
    comprobante.periodo_facturado_desde ?? comprobante.fecha,
  );
  const periodoHasta = formatDate(
    comprobante.periodo_facturado_hasta ?? comprobante.fecha,
  );
  const fechaVtoPago = formatDate(
    comprobante.fecha_vencimiento_pago ?? comprobante.fecha,
  );

  const muestraIvaItem =
    comprobante.iva_monto > 0 &&
    items.some((it) => it.iva_porcentaje != null || it.iva_monto != null);

  const emisorNombre = emisor.razon_social || emisor.nombre;
  const receptorNombre = cliente.razon_social || cliente.nombre;
  const condVenta = (comprobante.condicion_venta ?? '—').trim() || '—';

  doc.setDrawColor(0);
  doc.setLineWidth(0.35);

  // --- ORIGINAL centrado ---
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text(copiaLabel, pageWidth / 2, y, { align: 'center' });
  y += 6;

  // Cabecera: [ izquierda emisor ] [ caja C ] [ derecha tipo + datos fiscales emisor ]
  const headerTop = y;
  const splitMain = margin + 76;
  const centerBoxW = 16;
  const centerX = splitMain;
  const rightColStart = centerX + centerBoxW;

  // Caja letra + COD (texto primero; bordes al final de la cabecera)
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text(letra, centerX + centerBoxW / 2, headerTop + 16, { align: 'center' });
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  if (codAfip) {
    doc.text(`COD. ${codAfip}`, centerX + centerBoxW / 2, headerTop + 24, {
      align: 'center',
    });
  }

  // Columna izquierda — emisor (sin CUIT/IB aquí: van a la derecha en este layout)
  let yL = headerTop + 4;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  const anchoIzq = splitMain - margin - 6;
  const titleLines = doc.splitTextToSize(emisorNombre, anchoIzq);
  doc.text(titleLines, margin + 2, yL);
  yL += titleLines.length * 4.5 + 1;

  doc.setFontSize(7.5);
  yL = textoEtiquetaValor(
    doc,
    yL,
    margin + 2,
    anchoIzq,
    'Razón Social',
    emisorNombre,
  );
  if (emisor.domicilio) {
    yL = textoEtiquetaValor(
      doc,
      yL,
      margin + 2,
      anchoIzq,
      'Domicilio Comercial',
      emisor.domicilio,
    );
  }
  yL = textoEtiquetaValor(
    doc,
    yL,
    margin + 2,
    anchoIzq,
    'Condición frente al IVA',
    formatCondicionIvaAfip(emisor.condicion_iva),
  );

  // Columna derecha
  let yR = headerTop + 4;
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(tipoTitulo, rightColStart + 2, yR);
  yR += 6;
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.text(`Punto de Venta: ${pvStr}  |  Comp. Nro: ${nroStr}`, rightColStart + 2, yR);
  yR += 3.8;
  doc.text(`Fecha de Emisión: ${fechaEmision}`, rightColStart + 2, yR);
  yR += 3.8;
  if (emisor.cuit) {
    doc.text(`CUIT: ${emisor.cuit}`, rightColStart + 2, yR);
    yR += 3.8;
  }
  if (emisor.ingresos_brutos) {
    doc.text(`Ingresos Brutos: ${emisor.ingresos_brutos}`, rightColStart + 2, yR);
    yR += 3.8;
  }
  if (emisor.fecha_inicio_actividades) {
    doc.text(
      `Fecha de Inicio de Actividades: ${formatDate(emisor.fecha_inicio_actividades)}`,
      rightColStart + 2,
      yR,
    );
    yR += 3.8;
  }

  const headerBottom = Math.max(yL, yR, headerTop + 28) + 2;
  const headerH = headerBottom - headerTop;

  doc.setDrawColor(0);
  doc.setLineWidth(0.35);
  doc.rect(margin, headerTop, contentW, headerH, 'S');
  doc.line(splitMain, headerTop, splitMain, headerBottom);
  doc.line(rightColStart, headerTop, rightColStart, headerBottom);
  doc.rect(centerX, headerTop + 6, centerBoxW, 22, 'S');

  y = headerBottom + 3;

  // --- Período facturado (caja ancho completo) ---
  const periodH = 7;
  doc.rect(margin, y, contentW, periodH);
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  const periodTxt = `Período Facturado Desde: ${periodoDesde}     Hasta: ${periodoHasta}     Fecha de Vto. para el pago: ${fechaVtoPago}`;
  doc.text(periodTxt, margin + 2, y + 4.5);
  y += periodH + 3;

  // --- Receptor: caja con dos columnas (izq: CUIT, IVA, cond. venta | der: nombre, domicilio) ---
  const midClient = margin + contentW * 0.48;
  const boxClientTop = y;
  const leftBlockW = midClient - margin - 4;
  const rightBlockX = midClient + 1;
  const rightBlockW = innerRight - rightBlockX - 2;

  let yCL = boxClientTop + 3;
  const anchoCliIzq = leftBlockW - 2;
  yCL = textoEtiquetaValor(
    doc,
    yCL,
    margin + 2,
    anchoCliIzq,
    'CUIT',
    cliente.cuit_dni ?? '—',
  );
  yCL = textoEtiquetaValor(
    doc,
    yCL,
    margin + 2,
    anchoCliIzq,
    'Condición frente al IVA',
    formatCondicionIvaAfip(cliente.condicion_iva),
  );
  yCL = textoEtiquetaValor(
    doc,
    yCL,
    margin + 2,
    anchoCliIzq,
    'Condición de venta',
    condVenta,
  );

  let yCR = boxClientTop + 3;
  yCR = textoEtiquetaValor(
    doc,
    yCR,
    rightBlockX,
    rightBlockW - 2,
    'Apellido y Nombre / Razón Social',
    receptorNombre,
  );
  yCR = textoEtiquetaValor(
    doc,
    yCR,
    rightBlockX,
    rightBlockW - 2,
    'Domicilio',
    cliente.direccion ?? '—',
  );

  const boxClientH = Math.max(yCL, yCR) - boxClientTop + 3;
  doc.rect(margin, boxClientTop, contentW, boxClientH);
  doc.line(midClient, boxClientTop, midClient, boxClientTop + boxClientH);
  y = boxClientTop + boxClientH + 4;

  // --- Tabla ítems: encabezado gris + columnas con bordes ---
  const umDefault = 'unidades';
  const headerRowH = 6;

  // Anchos de columna (mm), suma = contentW
  const wCod = 14;
  const wCant = 13;
  const wUm = 16;
  const wPu = 20;
  const wBonP = 12;
  const wBonI = 16;
  const wSub = 18;
  const wDesc =
    contentW - wCod - wCant - wUm - wPu - wBonP - wBonI - wSub;

  const xCod = margin;
  const xDesc = xCod + wCod;
  const xCant = xDesc + wDesc;
  const xUm = xCant + wCant;
  const xPu = xUm + wUm;
  const xBonP = xPu + wPu;
  const xBonI = xBonP + wBonP;
  const xSub = xBonI + wBonI;

  function drawTableHeader(
    labels: {
      c1: string;
      c2: string;
      c3: string;
      c4: string;
      c5: string;
      c6: string;
      c7: string;
      c8: string;
    },
    yy: number,
  ) {
    doc.setFillColor(235, 235, 235);
    doc.rect(margin, yy, contentW, headerRowH, 'FD');
    doc.setDrawColor(0);
    doc.setFontSize(6.8);
    doc.setFont('helvetica', 'bold');
    doc.text(labels.c1, xCod + 0.5, yy + 4);
    doc.text(labels.c2, xDesc + 0.5, yy + 4);
    doc.text(labels.c3, xCant + wCant - 0.5, yy + 4, { align: 'right' });
    doc.text(labels.c4, xUm + wUm - 0.5, yy + 4, { align: 'right' });
    doc.text(labels.c5, xPu + wPu - 0.5, yy + 4, { align: 'right' });
    doc.text(labels.c6, xBonP + wBonP - 0.5, yy + 4, { align: 'right' });
    doc.text(labels.c7, xBonI + wBonI - 0.5, yy + 4, { align: 'right' });
    doc.text(labels.c8, xSub + wSub - 0.5, yy + 4, { align: 'right' });
    // Líneas verticales del encabezado
    let vx = margin;
    for (const w of [wCod, wDesc, wCant, wUm, wPu, wBonP, wBonI, wSub]) {
      vx += w;
      doc.line(vx, yy, vx, yy + headerRowH);
    }
    doc.line(margin, yy, margin, yy + headerRowH);
  }

  const tableStartY = y;
  if (muestraIvaItem) {
    drawTableHeader(
      {
        c1: 'Código',
        c2: 'Producto / Servicio',
        c3: 'Cantidad',
        c4: 'U. Medida',
        c5: 'Precio Unit.',
        c6: 'IVA %',
        c7: 'IVA',
        c8: 'Subtotal',
      },
      y,
    );
  } else {
    drawTableHeader(
      {
        c1: 'Código',
        c2: 'Producto / Servicio',
        c3: 'Cantidad',
        c4: 'U. Medida',
        c5: 'Precio Unit.',
        c6: '% Bonif.',
        c7: 'Imp. Bonif.',
        c8: 'Subtotal',
      },
      y,
    );
  }
  y += headerRowH;

  function drawRowLines(yy: number, rowH: number) {
    doc.line(margin, yy + rowH, innerRight, yy + rowH);
    let vx = margin;
    for (const w of [wCod, wDesc, wCant, wUm, wPu, wBonP, wBonI, wSub]) {
      vx += w;
      doc.line(vx, yy, vx, yy + rowH);
    }
    doc.line(margin, yy, margin, yy + rowH);
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);

  for (const item of items) {
    if (y > pageHeight - 52) {
      doc.addPage();
      y = margin;
    }

    const codStr = (item.codigo ?? '').trim() || '—';
    const descOnly = item.descripcion;
    const descLines = doc.splitTextToSize(descOnly, wDesc - 1);
    const rowH = Math.max(descLines.length * 3.3, 5);

    const rowTop = y;
    drawRowLines(rowTop, rowH);

    const yyText = rowTop + 4;
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
    doc.text(formatCurrency(item.precio_unitario), xPu + wPu - 0.5, yyText, {
      align: 'right',
    });

    if (muestraIvaItem) {
      const rate = item.iva_porcentaje;
      const iva = item.iva_monto ?? 0;
      doc.text(rate != null ? `${rate}%` : '—', xBonP + wBonP - 0.5, yyText, {
        align: 'right',
      });
      doc.text(formatCurrency(iva), xBonI + wBonI - 0.5, yyText, {
        align: 'right',
      });
    } else {
      doc.text(formatNumeroEs(0), xBonP + wBonP - 0.5, yyText, { align: 'right' });
      doc.text(formatNumeroEs(0), xBonI + wBonI - 0.5, yyText, { align: 'right' });
    }
    doc.text(formatCurrency(item.subtotal), xSub + wSub - 0.5, yyText, {
      align: 'right',
    });

    y = rowTop + rowH;
  }

  // Cierre borde tabla
  doc.line(margin, tableStartY, margin, y);
  doc.line(innerRight, tableStartY, innerRight, y);
  doc.line(margin, y, innerRight, y);
  doc.line(margin, tableStartY, innerRight, tableStartY);

  y += 5;

  // --- Totales (alineación fija: texto a la izquierda, importe a la derecha sin solapamiento) ---
  const totX = innerRight;
  const anchoEtiqueta = totX - margin - 34;

  function filaMontoSimple(etiqueta: string, monto: number, bold = false): void {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(bold ? 10 : 9);
    doc.text(formatCurrency(monto), totX, y, { align: 'right' });
    doc.text(etiqueta, margin, y, { maxWidth: anchoEtiqueta });
  }

  function filaMontoVariasLineas(
    lineasTexto: string[],
    monto: number,
    size = 8.5,
  ): void {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(size);
    const lh = 3.6;
    const alt = lineasTexto.length * lh;
    const yAmt = y + (lineasTexto.length <= 1 ? 2.8 : alt / 2 - 0.5);
    doc.text(formatCurrency(monto), totX, yAmt, { align: 'right' });
    doc.text(lineasTexto.join('\n'), margin, y);
    y += Math.max(alt + 1.5, 6.5);
  }

  const tm = comprobante.total_mercaderia;
  const fm = comprobante.financiacion_monto;
  const tieneFinanciacion =
    tm != null && fm != null && Math.abs(fm) > 0.001;

  doc.setFontSize(9);

  if (tieneFinanciacion) {
    // Con desc./recargo: el subtotal guardado es neto ajustado; primero mostramos el bruto de ítems.
    filaMontoSimple('Subtotal de ítems:', tm);
    y += 5;
    if (comprobante.iva_monto > 0) {
      filaMontoSimple(`Importe IVA (${comprobante.iva_porcentaje}%):`, comprobante.iva_monto);
      y += 5;
    }
  } else {
    filaMontoSimple('Subtotal:', comprobante.subtotal);
    y += 5;
    if (comprobante.iva_monto > 0) {
      filaMontoSimple(`Importe IVA (${comprobante.iva_porcentaje}%):`, comprobante.iva_monto);
      y += 5;
    }
  }

  const otrosTrib = comprobante.importe_otros_tributos;
  if (otrosTrib != null && Math.abs(otrosTrib) > 0.005) {
    filaMontoSimple('Importe Otros Tributos:', otrosTrib);
    y += 5;
  } else {
    filaMontoSimple('Importe Otros Tributos:', 0);
    y += 5;
  }

  if (tieneFinanciacion) {
    const pct = comprobante.financiacion_porcentaje;
    const pctLabel =
      pct != null && !Number.isNaN(pct) ? ` (${pct >= 0 ? '+' : ''}${pct}%)` : '';
    const fdesc = (comprobante.financiacion_descripcion ?? '').trim();
    const tituloBase =
      (fm ?? 0) < 0
        ? `Descuento financiero${pctLabel}`
        : `Recargo financiero${pctLabel}`;
    const parrafo = fdesc ? `${tituloBase}\n${fdesc}` : tituloBase;
    const lineas = doc.splitTextToSize(parrafo, anchoEtiqueta);
    filaMontoVariasLineas(lineas, fm ?? 0);
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  filaMontoSimple('Importe Total:', comprobante.total, true);
  y += 8;

  if (comprobante.cae) {
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(`CAE N°: ${comprobante.cae}`, margin, y);
    if (comprobante.cae_vencimiento) {
      doc.text(
        `Fecha de Vto. de CAE: ${formatDate(comprobante.cae_vencimiento)}`,
        innerRight,
        y,
        { align: 'right' },
      );
    }
    y += 4;
    doc.text('Comprobante Autorizado', margin, y);
    y += 3;
    doc.setFontSize(6.5);
    doc.setTextColor(60);
    doc.text(
      'Esta Agencia no se responsabiliza por los datos ingresados en el detalle de la operación.',
      margin,
      y,
    );
    doc.setTextColor(0);
    y += 4;
  }

  if (comprobante.notas) {
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'italic');
    const obsLines = doc.splitTextToSize(
      `Obs.: ${comprobante.notas}`,
      pageWidth - 2 * margin,
    );
    doc.text(obsLines, margin, y);
    y += obsLines.length * 3.2;
  }

  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.text(`Pág. 1/${doc.getNumberOfPages()}`, innerRight, pageHeight - 8, {
    align: 'right',
  });

  return doc;
}
