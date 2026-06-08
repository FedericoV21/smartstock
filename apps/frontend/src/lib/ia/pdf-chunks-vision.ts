import { PDFDocument } from 'pdf-lib';

/** Páginas por llamada a la IA (PDF). Config: IA_PDF_PAGES_PER_CHUNK (1–50, default 4). */
export function paginasPorChunkPdfVision(): number {
  const n = Number(process.env.IA_PDF_PAGES_PER_CHUNK);
  if (Number.isFinite(n) && n >= 1) return Math.min(Math.floor(n), 50);
  return 4;
}

export type PdfChunkVision = {
  bytes: Uint8Array;
  /** 1-based inclusive */
  pageFrom1: number;
  /** 1-based inclusive */
  pageTo1: number;
};

/**
 * Parte un PDF en trozos por página para varias extracciones (menos tokens por respuesta).
 * Si falla el parseo con pdf-lib, devuelve un solo chunk con el archivo original.
 */
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
      return {
        chunks: [{ bytes: pdfBytes, pageFrom1: 1, pageTo1: totalPages }],
        totalPages,
      };
    }

    const chunks: PdfChunkVision[] = [];
    for (let start = 0; start < totalPages; start += per) {
      const end = Math.min(start + per, totalPages);
      const indices = Array.from({ length: end - start }, (_, k) => start + k);
      const dst = await PDFDocument.create();
      const copied = await dst.copyPages(src, indices);
      for (const page of copied) {
        dst.addPage(page);
      }
      const bytes = await dst.save();
      chunks.push({ bytes, pageFrom1: start + 1, pageTo1: end });
    }
    return { chunks, totalPages };
  } catch (e) {
    console.warn('[pdf-chunks-vision] no se pudo partir el PDF, se envía entero', (e as Error).message);
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
  const tieneNombre = originalName.trim().length > 0;
  const base = tieneNombre ? originalName.replace(/\.pdf$/i, '') : 'lista';
  if (pageTo1 < 0) {
    return `${base}-parte${parte}de${totalPartes}.pdf`;
  }
  return `${base}-p${pageFrom1}-${pageTo1}-parte${parte}de${totalPartes}.pdf`;
}
