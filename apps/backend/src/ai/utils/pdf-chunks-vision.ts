import { PDFDocument } from 'pdf-lib';

export function paginasPorChunkPdfVision(): number {
  const n = Number(process.env.IA_PDF_PAGES_PER_CHUNK);
  if (Number.isFinite(n) && n >= 1) return Math.min(Math.floor(n), 50);
  return 4;
}

export type PdfChunkVision = {
  bytes: Uint8Array;
  pageFrom1: number;
  pageTo1: number;
};

export async function partirPdfParaVisionPorPaginas(
  pdfBytes: Uint8Array,
): Promise<{ chunks: PdfChunkVision[]; totalPages: number }> {
  try {
    const src = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const totalPages = src.getPageCount();
    if (totalPages <= 0) {
      return { chunks: [{ bytes: pdfBytes, pageFrom1: 1, pageTo1: 1 }], totalPages: 0 };
    }

    const per = paginasPorChunkPdfVision();
    if (totalPages <= per) {
      return { chunks: [{ bytes: pdfBytes, pageFrom1: 1, pageTo1: totalPages }], totalPages };
    }

    const chunks: PdfChunkVision[] = [];
    for (let start = 0; start < totalPages; start += per) {
      const end = Math.min(start + per, totalPages);
      const indices = Array.from({ length: end - start }, (_, k) => start + k);
      const dst = await PDFDocument.create();
      const copied = await dst.copyPages(src, indices);
      for (const page of copied) dst.addPage(page);
      const bytes = await dst.save();
      chunks.push({ bytes, pageFrom1: start + 1, pageTo1: end });
    }
    return { chunks, totalPages };
  } catch (e) {
    return { chunks: [{ bytes: pdfBytes, pageFrom1: 1, pageTo1: -1 }], totalPages: -1 };
  }
}

export function nombreArchivoChunkPdf(
  originalName: string,
  pageFrom1: number,
  pageTo1: number,
  parte: number,
  totalPartes: number,
): string {
  const base = originalName.trim().length > 0 ? originalName.replace(/\.pdf$/i, '') : 'lista';
  if (pageTo1 < 0) return `${base}-parte${parte}de${totalPartes}.pdf`;
  return `${base}-p${pageFrom1}-${pageTo1}-parte${parte}de${totalPartes}.pdf`;
}
