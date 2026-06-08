import jsPDF from 'jspdf';

import { medirYdibujarLogoEmisor } from '@/lib/facturacion/pdf-emisor-logo';
import { ymdArgentina } from '@/lib/reportes/periodos';
import { TIMEZONE_AR } from '@/lib/utils/formatters';

export type EmisorPdfInforme = {
  nombre: string;
  razonSocial?: string | null;
  cuit?: string | null;
  domicilio?: string | null;
  logoDataUrl?: string | null;
};

const MARGIN = 12;
const PAGE_W = 210;
const PAGE_H = 297;
const BODY_W = PAGE_W - 2 * MARGIN;
const FOOTER_Y = PAGE_H - 6;

/** Línea de acento bajo el título (RGB) */
const ACCENT = [14, 116, 144] as const;
const BORDER = [203, 213, 225] as const;
const HEADER_BG = [30, 64, 90] as const;
const META_BG = [241, 245, 249] as const;
const ZEBRA_A = [248, 250, 252] as const;
const ZEBRA_B = [255, 255, 255] as const;
const TEXT_MUTED = [71, 85, 105] as const;

const PAD_X = 1.8;
const PAD_Y = 2.2;
const FS_HEAD = 8;
const FS_BODY = 7.5;
const LINE_H = 3.15;

function ahoraArgentinaLabel(): string {
  return new Date().toLocaleString('es-AR', { timeZone: TIMEZONE_AR });
}

function sumWidths(a: number[]): number {
  return a.reduce((x, y) => x + y, 0);
}

/** Escala anchos para que sumen ≤ anchoMax (evita error si los callers usan 190 mm con BODY 186 mm). */
function normalizarAnchosTabla(anchosMm: number[], anchoMax: number): number[] {
  const raw = [...anchosMm];
  const total = sumWidths(raw);
  if (total <= anchoMax + 0.01) return raw;

  const scale = anchoMax / total;
  const scaled = raw.map((w) => Math.round(w * scale * 1000) / 1000);
  const drift = anchoMax - sumWidths(scaled);
  if (Math.abs(drift) > 0.001 && scaled.length > 0) {
    scaled[scaled.length - 1] = Math.round((scaled[scaled.length - 1] + drift) * 1000) / 1000;
  }
  return scaled;
}

export type OpcionesPdfTabla = {
  nombreArchivo: string;
  titulo: string;
  emisor?: EmisorPdfInforme | null;
  lineasMeta?: string[];
  notaLegal?: string[];
  encabezados: string[];
  anchosMm: number[];
  filas: string[][];
};

function pieDocumentoLabel(emisor?: EmisorPdfInforme | null): string {
  const negocio = emisor?.nombre?.trim() || 'SmartStock';
  return `${negocio} · ${ahoraArgentinaLabel()}`;
}

function dibujarCabeceraEmisor(doc: jsPDF, yStart: number, emisor: EmisorPdfInforme): number {
  let y = yStart;
  const logoBox = medirYdibujarLogoEmisor(doc, emisor.logoDataUrl, MARGIN, y);
  const textX = logoBox ? MARGIN + logoBox.width + 4 : MARGIN;
  const textW = BODY_W - (textX - MARGIN);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  const tituloEmisor = emisor.razonSocial?.trim() || emisor.nombre;
  const tituloLines = doc.splitTextToSize(tituloEmisor, textW);
  let ty = y + 4;
  for (const line of tituloLines) {
    doc.text(line, textX, ty);
    ty += 4.2;
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...TEXT_MUTED);
  const detalle: string[] = [];
  if (emisor.cuit?.trim()) detalle.push(`CUIT: ${emisor.cuit.trim()}`);
  if (emisor.domicilio?.trim()) detalle.push(emisor.domicilio.trim());
  for (const line of detalle) {
    const wrapped = doc.splitTextToSize(line, textW);
    for (const w of wrapped) {
      doc.text(w, textX, ty);
      ty += 3.5;
    }
  }

  const blockH = logoBox ? Math.max(logoBox.height, ty - y) : ty - y;
  y += blockH + 4;
  doc.setTextColor(0, 0, 0);
  return y;
}

function wrapCell(doc: jsPDF, text: string, maxW: number): string[] {
  return doc.splitTextToSize(String(text ?? ''), Math.max(4, maxW));
}

function rowHeight(doc: jsPDF, cells: string[], widths: number[], fontSize: number): number {
  doc.setFontSize(fontSize);
  let maxLines = 1;
  cells.forEach((cell, i) => {
    const lines = wrapCell(doc, cell, widths[i] - 2 * PAD_X);
    maxLines = Math.max(maxLines, lines.length);
  });
  return Math.max(7.5, maxLines * LINE_H + 2 * PAD_Y);
}

function drawTableRow(
  doc: jsPDF,
  yTop: number,
  rowH: number,
  x0: number,
  widths: number[],
  cells: string[],
  opts: {
    fill: [number, number, number];
    textColor: [number, number, number];
    font: 'bold' | 'normal';
    fontSize: number;
  },
): void {
  const n = widths.length;
  doc.setLineWidth(0.18);
  doc.setDrawColor(...BORDER);

  let x = x0;
  for (let i = 0; i < n; i++) {
    const w = widths[i];
    doc.setFillColor(...opts.fill);
    doc.rect(x, yTop, w, rowH, 'FD');

    doc.setFont('helvetica', opts.font);
    doc.setFontSize(opts.fontSize);
    doc.setTextColor(...opts.textColor);

    const lines = wrapCell(doc, cells[i] ?? '', w - 2 * PAD_X);
    let ty = yTop + PAD_Y + opts.fontSize * 0.28;
    for (const line of lines) {
      if (ty > yTop + rowH - 1) break;
      doc.text(line, x + PAD_X, ty);
      ty += LINE_H;
    }
    x += w;
  }

  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'normal');
}

/**
 * PDF A4 con tabla profesional: bordes, cabecera oscura, filas alternadas, metadatos en panel.
 */
export function descargarPdfTabla(opc: OpcionesPdfTabla): void {
  const n = opc.encabezados.length;
  if (n === 0) throw new Error('PDF: se requiere al menos una columna');
  if (opc.anchosMm.length !== n) {
    throw new Error('PDF: encabezados y anchosMm deben tener la misma longitud');
  }
  const anchoTabla = BODY_W - 0.02;
  const widths = normalizarAnchosTabla(opc.anchosMm, anchoTabla);
  const totalW = sumWidths(widths);

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  let y = MARGIN;
  const tableX0 = MARGIN + (BODY_W - totalW) / 2;

  const pie = () => {
    doc.setFontSize(7);
    doc.setTextColor(...TEXT_MUTED);
    doc.setFont('helvetica', 'normal');
    doc.text(pieDocumentoLabel(opc.emisor), MARGIN, FOOTER_Y);
    doc.setTextColor(0, 0, 0);
  };

  const nuevaPagina = () => {
    pie();
    doc.addPage();
    y = MARGIN;
  };

  const espacioDisponible = () => FOOTER_Y - y - 4;

  /** Título + línea de acento + meta en caja gris */
  const bloqueCabeceraDocumento = () => {
    if (opc.emisor) {
      y = dibujarCabeceraEmisor(doc, y, opc.emisor);
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(15, 23, 42);
    doc.text(opc.titulo, MARGIN, y);
    y += 5.5;
    doc.setDrawColor(...ACCENT);
    doc.setLineWidth(0.6);
    doc.line(MARGIN, y, MARGIN + Math.min(BODY_W, doc.getTextWidth(opc.titulo) + 4), y);
    y += 5;

    const metaLines = [...(opc.lineasMeta ?? []), ...(opc.notaLegal ?? [])];
    if (metaLines.length > 0) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(...TEXT_MUTED);
      let blockH = 3;
      const wrappedBlocks: string[][] = [];
      for (const line of metaLines) {
        const w = doc.splitTextToSize(line, BODY_W - 6);
        wrappedBlocks.push(w);
        blockH += w.length * 3.5 + 1;
      }
      if (y + blockH > FOOTER_Y - 16) nuevaPagina();
      doc.setFillColor(...META_BG);
      doc.setDrawColor(...BORDER);
      doc.roundedRect(MARGIN, y - 1, BODY_W, blockH, 1, 1, 'FD');
      let my = y + 3;
      for (const w of wrappedBlocks) {
        doc.text(w, MARGIN + 3, my);
        my += w.length * 3.5 + 0.8;
      }
      y += blockH + 2;
      doc.setTextColor(0, 0, 0);
    } else {
      y += 2;
    }
  };

  const dibujarEncabezadoTabla = () => {
    const cells = opc.encabezados.map((h) => h);
    const h = rowHeight(doc, cells, widths, FS_HEAD);
    if (espacioDisponible() < h + 4) {
      nuevaPagina();
    }
    drawTableRow(doc, y, h, tableX0, widths, cells, {
      fill: [...HEADER_BG],
      textColor: [255, 255, 255],
      font: 'bold',
      fontSize: FS_HEAD,
    });
    y += h;
  };

  bloqueCabeceraDocumento();
  dibujarEncabezadoTabla();

  let rowIdx = 0;
  for (const raw of opc.filas) {
    const cells = [...raw];
    while (cells.length < n) cells.push('');
    const trimmed = cells.slice(0, n);
    const h = rowHeight(doc, trimmed, widths, FS_BODY);
    if (espacioDisponible() < h) {
      nuevaPagina();
      dibujarEncabezadoTabla();
    }
    const fill: [number, number, number] = rowIdx % 2 === 0 ? [...ZEBRA_A] : [...ZEBRA_B];
    drawTableRow(doc, y, h, tableX0, widths, trimmed, {
      fill,
      textColor: [15, 23, 42],
      font: 'normal',
      fontSize: FS_BODY,
    });
    y += h;
    rowIdx += 1;
  }

  /** Borde exterior de la tabla en esta página (opcional refinamiento): línea bajo última fila ya viene por celdas */
  pie();
  doc.save(opc.nombreArchivo);
}

export type OpcionesPdfResumen = {
  nombreArchivo: string;
  titulo: string;
  emisor?: EmisorPdfInforme | null;
  lineasMeta?: string[];
  secciones: { titulo: string; filas: { etiqueta: string; valor: string }[] }[];
};

/** Resumen con tablas de dos columnas (etiqueta | valor) por sección. */
export function descargarPdfResumen(opc: OpcionesPdfResumen): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  let y = MARGIN;
  const colEtq = 58;
  const colVal = BODY_W - colEtq;
  const tableX = MARGIN;

  const pie = () => {
    doc.setFontSize(7);
    doc.setTextColor(...TEXT_MUTED);
    doc.setFont('helvetica', 'normal');
    doc.text(pieDocumentoLabel(opc.emisor), MARGIN, FOOTER_Y);
    doc.setTextColor(0, 0, 0);
  };

  const nuevaPagina = () => {
    pie();
    doc.addPage();
    y = MARGIN;
  };

  if (opc.emisor) {
    y = dibujarCabeceraEmisor(doc, y, opc.emisor);
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text(opc.titulo, MARGIN, y);
  y += 5.5;
  doc.setDrawColor(...ACCENT);
  doc.setLineWidth(0.6);
  doc.line(MARGIN, y, MARGIN + Math.min(BODY_W, doc.getTextWidth(opc.titulo) + 4), y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...TEXT_MUTED);
  for (const line of opc.lineasMeta ?? []) {
    const w = doc.splitTextToSize(line, BODY_W);
    const h = w.length * 3.5 + 0.5;
    if (y + h > FOOTER_Y - 12) nuevaPagina();
    doc.text(w, MARGIN, y);
    y += h;
  }
  doc.setTextColor(0, 0, 0);
  y += 4;

  for (const sec of opc.secciones) {
    if (y > FOOTER_Y - 28) nuevaPagina();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(...HEADER_BG);
    doc.text(sec.titulo, MARGIN, y);
    y += 5;

    let r = 0;
    for (const row of sec.filas) {
      const labelLines = wrapCell(doc, row.etiqueta, colEtq - 2 * PAD_X);
      const valLines = wrapCell(doc, row.valor, colVal - 2 * PAD_X);
      const lines = Math.max(labelLines.length, valLines.length);
      const rowH = Math.max(7, lines * LINE_H + 2 * PAD_Y);
      if (y + rowH > FOOTER_Y - 4) {
        nuevaPagina();
      }

      const fill: [number, number, number] = r % 2 === 0 ? [...ZEBRA_A] : [...ZEBRA_B];
      doc.setLineWidth(0.18);
      doc.setDrawColor(...BORDER);
      doc.setFillColor(...fill);
      doc.rect(tableX, y, colEtq, rowH, 'FD');
      doc.rect(tableX + colEtq, y, colVal, rowH, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(FS_BODY);
      doc.setTextColor(15, 23, 42);
      let ty = y + PAD_Y + FS_BODY * 0.28;
      for (const ln of labelLines) {
        doc.text(ln, tableX + PAD_X, ty);
        ty += LINE_H;
      }

      doc.setFont('helvetica', 'normal');
      ty = y + PAD_Y + FS_BODY * 0.28;
      for (const ln of valLines) {
        doc.text(ln, tableX + colEtq + PAD_X, ty);
        ty += LINE_H;
      }

      doc.setTextColor(0, 0, 0);
      y += rowH;
      r += 1;
    }
    y += 5;
  }

  pie();
  doc.save(opc.nombreArchivo);
}

export function nombrePdfReporte(slug: string): string {
  const base = slug.replace(/[^\w.-]+/g, '_').slice(0, 80);
  return `${base}-${ymdArgentina()}.pdf`;
}
