import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  cleanPdfText,
  convertirChunksPdfATabla,
  type PdfTablaConvertida,
  type PdfTextChunk,
} from './pdf-a-tabla-core';

type PdfTextItem = {
  str: string;
  transform: unknown[];
  width: number;
  height: number;
};

function isTextItem(item: unknown): item is PdfTextItem {
  return (
    item != null &&
    typeof item === 'object' &&
    'str' in item &&
    typeof (item as { str?: unknown }).str === 'string' &&
    Array.isArray((item as { transform?: unknown }).transform)
  );
}

export async function convertirPdfTextoATabla(bytes: Uint8Array): Promise<PdfTablaConvertida> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
    join(process.cwd(), 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs'),
  ).href;

  const loadingTask = pdfjs.getDocument({
    data: bytes,
    useSystemFonts: true,
    useWorkerFetch: false,
    isEvalSupported: false,
  });
  const doc = await loadingTask.promise;
  const chunks: PdfTextChunk[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const textContent = await page.getTextContent();
      for (const item of textContent.items) {
        if (!isTextItem(item)) continue;
        const text = cleanPdfText(item.str);
        if (!text) continue;
        const xRaw = item.transform[4];
        const yRaw = item.transform[5];
        const x = typeof xRaw === 'number' ? xRaw : Number(xRaw);
        const y = typeof yRaw === 'number' ? yRaw : Number(yRaw);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        chunks.push({
          text,
          x,
          y,
          width: Number.isFinite(item.width) ? item.width : 0,
          height: Number.isFinite(item.height) ? item.height : 0,
          page: pageNumber,
        });
      }
    }
  } finally {
    await doc.destroy();
  }

  return convertirChunksPdfATabla(chunks);
}
