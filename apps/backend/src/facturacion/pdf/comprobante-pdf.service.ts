import { Injectable, Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';

import { TipoComprobante } from '../enums/tipo-comprobante.enum';
import {
  buildCadenaCodigoBarrasAfip,
  mapTipoComprobanteAfip,
} from './codigo-barras-fiscal.util';

type PdfItem = {
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
};

type GenerateComprobantePdfInput = {
  tipo: TipoComprobante;
  numero: number;
  fecha: string;
  emisor: {
    nombre: string;
    cuit?: string | null;
  };
  receptor?: {
    nombre?: string | null;
    cuitDni?: string | null;
  } | null;
  items: PdfItem[];
  subtotal: number;
  ivaMonto: number;
  total: number;
  totalMercaderia?: number | null;
  financiacionMonto?: number | null;
  financiacionPorcentaje?: number | null;
  financiacionDescripcion?: string | null;
  fiscal?: {
    cae?: string | null;
    caeVencimiento?: string | null;
    qrContenido?: string | null;
    /** CUIT emisor (con o sin guiones). Si falta, se usa `emisor.cuit`. */
    cuitEmisor?: string | null;
    /** Punto de venta ARCA (requerido para el c├│digo de barras). */
    puntoVenta?: number | null;
  } | null;
};

@Injectable()
export class ComprobantePdfService {
  private readonly logger = new Logger(ComprobantePdfService.name);

  async generateComprobantePdf(input: GenerateComprobantePdfInput): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 36 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));

    this.renderHeader(doc, input);
    this.renderItemsTable(doc, input.items);
    this.renderTotals(doc, input);
    await this.renderFiscalBlock(doc, input);

    doc.end();

    await new Promise<void>((resolve) => doc.on('end', () => resolve()));
    return Buffer.concat(chunks);
  }

  private renderHeader(doc: PDFKit.PDFDocument, input: GenerateComprobantePdfInput): void {
    doc.fontSize(16).text('SmartStock', { align: 'left' });
    doc.fontSize(12).text(`Comprobante: ${input.tipo} #${input.numero}`);
    doc.fontSize(10).text(`Fecha: ${input.fecha}`);
    doc.moveDown(0.5);
    doc.text(`Emisor: ${input.emisor.nombre}`);
    if (input.emisor.cuit) {
      doc.text(`CUIT Emisor: ${input.emisor.cuit}`);
    }
    if (input.receptor?.nombre) {
      doc.text(`Cliente: ${input.receptor.nombre}`);
    }
    if (input.receptor?.cuitDni) {
      doc.text(`CUIT/DNI Cliente: ${input.receptor.cuitDni}`);
    }
    doc.moveDown();
  }

  private renderItemsTable(doc: PDFKit.PDFDocument, items: PdfItem[]): void {
    doc.fontSize(11).text('Detalle', { underline: true });
    doc.moveDown(0.3);
    for (const item of items) {
      doc
        .fontSize(10)
        .text(
          `${item.descripcion} | cant: ${item.cantidad.toFixed(3)} | unit: ${item.precioUnitario.toFixed(
            2,
          )} | subtotal: ${item.subtotal.toFixed(2)}`,
        );
    }
    doc.moveDown();
  }

  private renderTotals(doc: PDFKit.PDFDocument, input: GenerateComprobantePdfInput): void {
    doc.fontSize(11).text('Totales', { underline: true });
    if (input.totalMercaderia != null && Math.abs(input.totalMercaderia - input.total) > 0.001) {
      doc.fontSize(10).text(`Mercader├¡a: $${input.totalMercaderia.toFixed(2)}`);
    }
    if (input.financiacionMonto != null && Math.abs(input.financiacionMonto) > 0.001) {
      const desc = input.financiacionDescripcion?.trim();
      doc
        .fontSize(10)
        .text(
          `${desc || 'Ajuste medio de pago'}: ${input.financiacionMonto >= 0 ? '+' : ''}$${input.financiacionMonto.toFixed(2)}`,
        );
    }
    doc.fontSize(10).text(`Subtotal: $${input.subtotal.toFixed(2)}`);
    doc.fontSize(10).text(`IVA: $${input.ivaMonto.toFixed(2)}`);
    doc.fontSize(11).text(`Total: $${input.total.toFixed(2)}`);
    doc.moveDown();
  }

  /** CAE, QR, cadena num├®rica ARCA e imagen I25 (NB-ARC-105). */
  private async renderFiscalBlock(doc: PDFKit.PDFDocument, input: GenerateComprobantePdfInput): Promise<void> {
    const fiscal = input.fiscal ?? null;
    doc.fontSize(11).text('Bloque fiscal', { underline: true });
    doc.fontSize(10).text(`CAE: ${fiscal?.cae ?? 'pendiente'}`);
    doc.fontSize(10).text(`Vencimiento CAE: ${fiscal?.caeVencimiento ?? 'pendiente'}`);
    doc.fontSize(10).text(`QR Fiscal: ${fiscal?.qrContenido ? 'generado' : 'pendiente'}`);

    const tipoAfip = mapTipoComprobanteAfip(input.tipo);
    const cuitRaw = fiscal?.cuitEmisor ?? input.emisor.cuit ?? null;
    const pv = fiscal?.puntoVenta;
    const cae = fiscal?.cae?.trim() ?? '';
    const vto = fiscal?.caeVencimiento?.trim() ?? '';

    if (!cae || !vto || !cuitRaw || typeof pv !== 'number' || !Number.isFinite(pv) || tipoAfip === null) {
      doc.moveDown(0.3);
      doc.fontSize(8).fillColor('#555555').text('C├│digo de barras fiscal: pendiente (CAE + CUIT + PV + tipo).');
      doc.fillColor('#000000');
      return;
    }

    try {
      const cadena = buildCadenaCodigoBarrasAfip({
        cuitEmisor: cuitRaw,
        tipoCbteAfip: tipoAfip,
        puntoVenta: pv,
        cae,
        caeVencimiento: vto,
      });
      doc.moveDown(0.4);
      doc.fontSize(9).fillColor('#000000').text(`C├│digo de barras (ARCA / I25): ${cadena}`);
      const png = await this.encodeInterleaved2of5(cadena);
      const x = doc.page.margins.left;
      const y = doc.y + 2;
      doc.image(png, x, y, { width: 280 });
      doc.y = y + 52;
      doc.moveDown(0.2);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`PDF c├│digo de barras fiscal omitido: ${msg}`);
      doc.moveDown(0.3);
      doc.fontSize(8).fillColor('#aa0000').text(`C├│digo de barras fiscal: error (${msg})`);
      doc.fillColor('#000000');
    }
  }

  private encodeInterleaved2of5(cadena: string): Promise<Buffer> {
    // bwip-js es CJS; tipado laxo para callback.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bwipjs = require('bwip-js') as {
      toBuffer: (
        opts: Record<string, unknown>,
        cb: (err: Error | string | undefined | null, png: Buffer) => void,
      ) => void;
    };
    return new Promise((resolve, reject) => {
      bwipjs.toBuffer(
        {
          bcid: 'interleaved2of5',
          text: cadena,
          scale: 2,
          height: 14,
          includetext: true,
          textxalign: 'center',
          textsize: 7,
        },
        (err: Error | string | undefined | null, png: Buffer) => {
          if (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
            return;
          }
          resolve(png);
        },
      );
    });
  }
}
