import jsPDF from 'jspdf';
import { createHmac } from 'node:crypto';

type PdfReportParams = {
  db: any;
  tenantId: string;
  reportKey: string;
  title: string;
  subtitleLines?: string[];
  columns: string[];
  rows: string[][];
};

function safeSlug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function splitCell(doc: jsPDF, value: string, width: number): string[] {
  return doc.splitTextToSize(String(value ?? ''), Math.max(8, width));
}

function toBuffer(doc: jsPDF): Buffer {
  return Buffer.from(doc.output('arraybuffer'));
}

function signedUrlTtlSeconds(): number {
  const raw = Number(process.env.WHATSAPP_REPORT_SIGNED_URL_TTL_SECONDS ?? 3600);
  if (!Number.isFinite(raw)) return 3600;
  return Math.max(300, Math.min(24 * 60 * 60, Math.trunc(raw)));
}

function appBaseUrl(): string | null {
  const direct =
    (process.env.NEXT_PUBLIC_APP_URL ?? '').trim() || (process.env.APP_URL ?? '').trim();
  if (direct) return direct.replace(/\/+$/, '');

  const vercel = (process.env.VERCEL_URL ?? '').trim();
  if (vercel) return `https://${vercel}`.replace(/\/+$/, '');
  return null;
}

function reportLinkSecret(): string | null {
  const direct = (process.env.WHATSAPP_REPORT_LINK_SECRET ?? '').trim();
  if (direct) return direct;
  const fallback = (process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? '').trim();
  return fallback || null;
}

function buildShortReportLink(params: {
  bucket: string;
  path: string;
  ttlSeconds: number;
}): string | null {
  const base = appBaseUrl();
  const secret = reportLinkSecret();
  if (!base || !secret) return null;

  const exp = Date.now() + params.ttlSeconds * 1000;
  const payloadJson = JSON.stringify({
    b: params.bucket,
    p: params.path,
    e: exp,
  });
  const payload = Buffer.from(payloadJson, 'utf8').toString('base64url');
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${base}/api/whatsapp/report/download?t=${payload}.${sig}`;
}

function buildPdfBuffer(params: {
  title: string;
  subtitleLines?: string[];
  columns: string[];
  rows: string[][];
}): Buffer {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

  const margin = 12;
  const pageWidth = 210;
  const pageHeight = 297;
  const footerY = pageHeight - 6;
  const tableWidth = pageWidth - margin * 2;
  const colWidth = tableWidth / Math.max(1, params.columns.length);

  let y = margin;

  const addFooter = () => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(90, 90, 90);
    doc.text(`SmartStock · ${new Date().toLocaleString('es-AR')}`, margin, footerY);
    doc.setTextColor(0, 0, 0);
  };

  const nextPage = () => {
    addFooter();
    doc.addPage();
    y = margin;
  };

  const ensureSpace = (needed: number) => {
    if (y + needed > footerY - 4) nextPage();
  };

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(params.title, margin, y);
  y += 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(80, 80, 80);
  for (const line of params.subtitleLines ?? []) {
    const wrapped = doc.splitTextToSize(line, tableWidth);
    const h = wrapped.length * 3.6 + 1;
    ensureSpace(h);
    doc.text(wrapped, margin, y);
    y += h;
  }
  doc.setTextColor(0, 0, 0);
  y += 2;

  const drawHeader = () => {
    ensureSpace(8);
    doc.setFillColor(30, 64, 90);
    doc.rect(margin, y, tableWidth, 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    params.columns.forEach((col, i) => {
      const x = margin + i * colWidth + 1.4;
      doc.text(String(col), x, y + 4.6);
    });
    doc.setTextColor(0, 0, 0);
    y += 7;
  };

  drawHeader();

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);

  params.rows.forEach((row, rowIndex) => {
    const fixedRow = params.columns.map((_, i) => String(row[i] ?? ''));
    const linesPerCell = fixedRow.map((cell) => splitCell(doc, cell, colWidth - 2.6));
    const maxLines = Math.max(1, ...linesPerCell.map((x) => x.length));
    const rowH = Math.max(6.4, maxLines * 3.2 + 2);

    if (y + rowH > footerY - 4) {
      nextPage();
      drawHeader();
    }

    if (rowIndex % 2 === 0) {
      doc.setFillColor(248, 250, 252);
      doc.rect(margin, y, tableWidth, rowH, 'F');
    }

    doc.setDrawColor(205, 205, 205);
    doc.rect(margin, y, tableWidth, rowH);

    for (let i = 1; i < params.columns.length; i++) {
      const xLine = margin + i * colWidth;
      doc.line(xLine, y, xLine, y + rowH);
    }

    linesPerCell.forEach((lines, i) => {
      const x = margin + i * colWidth + 1.4;
      let ty = y + 3.8;
      for (const line of lines) {
        if (ty > y + rowH - 1) break;
        doc.text(line, x, ty);
        ty += 3.2;
      }
    });

    y += rowH;
  });

  addFooter();
  return toBuffer(doc);
}

export async function generateAndUploadWhatsAppReportPdf(params: PdfReportParams): Promise<string | null> {
  if (!params.rows.length) return null;

  const pdfBuffer = buildPdfBuffer({
    title: params.title,
    subtitleLines: params.subtitleLines,
    columns: params.columns,
    rows: params.rows,
  });

  const reportSlug = safeSlug(params.reportKey || 'reporte');
  const path = `${params.tenantId}/whatsapp-reportes/${Date.now()}-${reportSlug}.pdf`;

  const { error: uploadErr } = await params.db.storage.from('comprobantes').upload(path, pdfBuffer, {
    contentType: 'application/pdf',
    upsert: false,
  });
  if (uploadErr) {
    console.error('[wa-report-pdf] upload error', {
      tenantId: params.tenantId,
      reportKey: params.reportKey,
      path,
      error: uploadErr.message,
    });
    return null;
  }

  const ttl = signedUrlTtlSeconds();
  const shortLink = buildShortReportLink({
    bucket: 'comprobantes',
    path,
    ttlSeconds: ttl,
  });
  if (shortLink) {
    return shortLink;
  }

  const { data: signed, error: signErr } = await params.db.storage
    .from('comprobantes')
    .createSignedUrl(path, ttl);

  if (signErr || !signed?.signedUrl) {
    console.error('[wa-report-pdf] sign error', {
      tenantId: params.tenantId,
      reportKey: params.reportKey,
      path,
      error: signErr?.message ?? 'signed url missing',
    });
    return null;
  }

  return signed.signedUrl;
}
