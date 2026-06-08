import bwipjs from 'bwip-js';
import jsPDF from 'jspdf';

import { opcionesBwipEtiqueta } from '@/lib/pos/etiqueta-barcode-render';
import { formatearEAN13, validarEAN13 } from '@/lib/pos/ean13';
import { formatCurrency, hoyEnAR } from '@/lib/utils/formatters';

export type HojaEtiquetaSize = '50x30' | '80x40' | 'a4';

export type HojaEtiquetaPdfItem = {
  id: string;
  codigo: string | null | undefined;
  nombre: string;
  codigoBarras: string;
  precioVenta: number | null | undefined;
  copias: number;
};

export type HojaEtiquetasLayout = {
  pageWidthMm: number;
  pageHeightMm: number;
  labelWidthMm: number;
  labelHeightMm: number;
  columns: number;
  rows: number;
  originX: number;
  originY: number;
  labelsPerPage: number;
  labelSize: '50x30' | '80x40';
};

type BarcodeImage = {
  dataUrl: string;
  width: number;
  height: number;
};

const PAGE_W = 210;
const PAGE_H = 297;

export function calcularLayoutHojaEtiquetas(size: HojaEtiquetaSize): HojaEtiquetasLayout {
  const labelSize = size === '80x40' ? '80x40' : '50x30';
  const labelWidthMm = labelSize === '80x40' ? 80 : 50;
  const labelHeightMm = labelSize === '80x40' ? 40 : 30;
  const columns = Math.max(1, Math.floor(PAGE_W / labelWidthMm));
  const rows = Math.max(1, Math.floor(PAGE_H / labelHeightMm));
  const originX = (PAGE_W - columns * labelWidthMm) / 2;
  const originY = (PAGE_H - rows * labelHeightMm) / 2;

  return {
    pageWidthMm: PAGE_W,
    pageHeightMm: PAGE_H,
    labelWidthMm,
    labelHeightMm,
    columns,
    rows,
    originX,
    originY,
    labelsPerPage: columns * rows,
    labelSize,
  };
}

function copiasNormalizadas(copias: number): number {
  if (!Number.isFinite(copias)) return 1;
  return Math.max(1, Math.trunc(copias));
}

function expandirEtiquetas(items: HojaEtiquetaPdfItem[]): HojaEtiquetaPdfItem[] {
  const out: HojaEtiquetaPdfItem[] = [];
  for (const item of items) {
    for (let i = 0; i < copiasNormalizadas(item.copias); i++) {
      out.push(item);
    }
  }
  return out;
}

function textoPdf(text: string | number | null | undefined): string {
  return String(text ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
}

function lineasAjustadas(
  doc: jsPDF,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const lines = (doc.splitTextToSize(textoPdf(text), maxWidth) as string[]).slice(0, maxLines);
  if (lines.length === 0) return [''];

  const original = doc.splitTextToSize(textoPdf(text), maxWidth) as string[];
  if (original.length > maxLines) {
    let last = `${lines[lines.length - 1]}...`;
    while (last.length > 3 && doc.getTextWidth(last) > maxWidth) {
      last = `${last.slice(0, -4)}...`;
    }
    lines[lines.length - 1] = last;
  }
  return lines;
}

function textoLegibleCodigo(codigo: string): string {
  const trimmed = codigo.trim();
  if (!trimmed) return '';
  return validarEAN13(trimmed) ? formatearEAN13(trimmed) : trimmed;
}

function barcodeImage(
  codigo: string,
  size: '50x30' | '80x40',
  cache: Map<string, BarcodeImage | null>,
): BarcodeImage | null {
  const key = `${size}|${codigo}`;
  if (cache.has(key)) return cache.get(key) ?? null;

  const opts = opcionesBwipEtiqueta(codigo, size);
  if (!opts) {
    cache.set(key, null);
    return null;
  }

  try {
    const canvas = document.createElement('canvas');
    bwipjs.toCanvas(canvas, {
      bcid: opts.bcid,
      text: opts.text,
      scale: opts.scale,
      height: opts.height,
      includetext: false,
    });
    const image = {
      dataUrl: canvas.toDataURL('image/png'),
      width: canvas.width,
      height: canvas.height,
    };
    cache.set(key, image);
    return image;
  } catch {
    cache.set(key, null);
    return null;
  }
}

function fontPrecioAjustado(
  doc: jsPDF,
  text: string,
  maxWidth: number,
  isSmall: boolean,
): number {
  const maxFont = isSmall ? 14.5 : 19;
  const minFont = isSmall ? 9.5 : 13;

  for (let fontSize = maxFont; fontSize >= minFont; fontSize -= 0.25) {
    doc.setFontSize(fontSize);
    if (doc.getTextWidth(text) <= maxWidth) return fontSize;
  }

  return minFont;
}

function dibujarEtiqueta(
  doc: jsPDF,
  item: HojaEtiquetaPdfItem,
  x: number,
  y: number,
  layout: HojaEtiquetasLayout,
  barcodeCache: Map<string, BarcodeImage | null>,
): void {
  const isSmall = layout.labelSize === '50x30';
  const pad = isSmall ? 1.5 : 2;
  const centerX = x + layout.labelWidthMm / 2;
  const contentW = layout.labelWidthMm - pad * 2;

  doc.setDrawColor(170, 170, 170);
  doc.setLineWidth(0.15);
  doc.setLineDashPattern([0.8, 0.8], 0);
  doc.rect(x, y, layout.labelWidthMm, layout.labelHeightMm);
  doc.setLineDashPattern([], 0);

  doc.setTextColor(20, 20, 20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(isSmall ? 6.5 : 8.5);
  const nombreLines = lineasAjustadas(doc, item.nombre, contentW, 2);
  const nombreTop = y + (isSmall ? 3.3 : 4.4);
  const nombreLineH = isSmall ? 2.6 : 3.25;
  nombreLines.forEach((line, idx) => {
    doc.text(line, centerX, nombreTop + idx * nombreLineH, { align: 'center' });
  });

  const barcodeSlotTop = y + (isSmall ? 9 : 12);
  const barcodeSlotH = isSmall ? 8.2 : 11.6;
  const barcodeSlotW = contentW;
  const barcode = barcodeImage(item.codigoBarras, layout.labelSize, barcodeCache);
  if (barcode) {
    const ratio = barcode.width / Math.max(1, barcode.height);
    const drawW = Math.min(barcodeSlotW, barcodeSlotH * ratio);
    const drawH = Math.min(barcodeSlotH, barcodeSlotW / ratio);
    doc.addImage(
      barcode.dataUrl,
      'PNG',
      centerX - drawW / 2,
      barcodeSlotTop + (barcodeSlotH - drawH) / 2,
      drawW,
      drawH,
    );
  }

  doc.setFont('courier', 'bold');
  doc.setFontSize(isSmall ? 5.5 : 6.5);
  doc.text(textoLegibleCodigo(item.codigoBarras), centerX, y + (isSmall ? 19.2 : 26.6), {
    align: 'center',
    maxWidth: contentW,
  });

  doc.setFont('helvetica', 'bold');
  const precioTexto = textoPdf(formatCurrency(item.precioVenta ?? 0));
  doc.setFontSize(fontPrecioAjustado(doc, precioTexto, contentW, isSmall));
  doc.text(precioTexto, centerX, y + (isSmall ? 25.7 : 34.2), {
    align: 'center',
  });

}

export function generarHojaEtiquetasPdf(
  items: HojaEtiquetaPdfItem[],
  size: HojaEtiquetaSize,
): jsPDF {
  const layout = calcularLayoutHojaEtiquetas(size);
  const etiquetas = expandirEtiquetas(items);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const barcodeCache = new Map<string, BarcodeImage | null>();

  etiquetas.forEach((item, index) => {
    if (index > 0 && index % layout.labelsPerPage === 0) {
      doc.addPage();
    }
    const pageIndex = index % layout.labelsPerPage;
    const col = pageIndex % layout.columns;
    const row = Math.floor(pageIndex / layout.columns);
    const x = layout.originX + col * layout.labelWidthMm;
    const y = layout.originY + row * layout.labelHeightMm;
    dibujarEtiqueta(doc, item, x, y, layout, barcodeCache);
  });

  return doc;
}

export function nombreArchivoHojaEtiquetas(): string {
  return `hoja-etiquetas-${hoyEnAR()}.pdf`;
}

export function descargarHojaEtiquetasPdf(
  items: HojaEtiquetaPdfItem[],
  size: HojaEtiquetaSize,
): void {
  const doc = generarHojaEtiquetasPdf(items, size);
  doc.save(nombreArchivoHojaEtiquetas());
}
