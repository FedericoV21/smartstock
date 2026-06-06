import {
  HttpException,
  HttpStatus,
  UnprocessableEntityException,
} from '@nestjs/common';

import { intentarParseObjetoJsonModelo } from '../../../ai/utils/json-respuesta-ia';
import {
  nombreArchivoChunkPdf,
  paginasPorChunkPdfVision,
  partirPdfParaVisionPorPaginas,
} from '../../../ai/utils/pdf-chunks-vision';
import { PROMPT_EXTRACCION_PRECIOS } from '../../../ai/utils/prompts';
import {
  normalizarProductoDesdeIa,
  type ProductoRawIa,
} from '../../../ai/utils/normalizar-producto-ia.util';
import { esErrorExtraccionVisionIA } from '../../../ai/utils/vision-ia-error';
import { llamarVisionExtraccionJson } from '../../../ai/utils/vision-extraccion';
import type { ItemExtraidoLista } from '../types/item-extraido-lista.type';
import { normalizarString } from './lista-matching.util';

interface GeminiResult {
  productos: ProductoRawIa[];
}

function mapVisionError(err: unknown, contexto: string): HttpException {
  if (esErrorExtraccionVisionIA(err) && (err.code === 'api_key' || err.code === 'config')) {
    return new HttpException((err as Error).message, HttpStatus.SERVICE_UNAVAILABLE);
  }
  if (esErrorExtraccionVisionIA(err) && err.code === 'timeout') {
    return new HttpException((err as Error).message, HttpStatus.GATEWAY_TIMEOUT);
  }
  return new HttpException(
    `Error al procesar ${contexto} del archivo: ${(err as Error).message || 'Error de IA'}`,
    HttpStatus.BAD_GATEWAY,
  );
}

function productosAIaItems(productos: ProductoRawIa[]): ItemExtraidoLista[] {
  return productos
    .map((p) => normalizarProductoDesdeIa(p))
    .filter((p): p is NonNullable<typeof p> => p != null)
    .map((p, i) => {
      const precio = p.precioVenta ?? p.precioCosto ?? 0;
      return {
        orden: i + 1,
        codigo_proveedor: p.codigo,
        nombre_raw: p.nombre,
        nombre_normalizado: normalizarString(p.nombre),
        precio_lista: precio,
        unidad: p.unidad,
        presentacion_inferida: null,
      };
    })
    .filter((item) => item.precio_lista >= 0 && item.nombre_raw.trim() !== '');
}

export async function extraerItemsListaConVision(
  buffer: Buffer,
  mimeType: string,
  nombreArchivo: string,
): Promise<ItemExtraidoLista[]> {
  const productosBrutos: ProductoRawIa[] = [];

  if (mimeType === 'application/pdf') {
    const pdfBytes = new Uint8Array(buffer);
    const { chunks } = await partirPdfParaVisionPorPaginas(pdfBytes);

    for (let ci = 0; ci < chunks.length; ci++) {
      const ch = chunks[ci]!;
      const chunkBase64 = Buffer.from(ch.bytes).toString('base64');
      const chunkLabel =
        chunks.length === 1
          ? nombreArchivo
          : nombreArchivoChunkPdf(
              nombreArchivo || 'documento.pdf',
              ch.pageFrom1,
              ch.pageTo1,
              ci + 1,
              chunks.length,
            );

      let textoChunk: string;
      try {
        const vr = await llamarVisionExtraccionJson(
          PROMPT_EXTRACCION_PRECIOS,
          { base64: chunkBase64, mimeType },
          { fileName: chunkLabel },
        );
        textoChunk = vr.text;
      } catch (err) {
        throw mapVisionError(err, `parte ${ci + 1} de ${chunks.length}`);
      }

      const parsed = intentarParseObjetoJsonModelo(textoChunk);
      if (!parsed) {
        throw new UnprocessableEntityException(
          `La IA no devolvi├│ JSON v├ílido en la parte ${ci + 1} de ${chunks.length} del PDF.`,
        );
      }

      const resultadoParte = parsed.data as GeminiResult;
      if (!Array.isArray(resultadoParte.productos)) {
        throw new UnprocessableEntityException(
          `La respuesta de la parte ${ci + 1} de ${chunks.length} no contiene un array de productos`,
        );
      }
      productosBrutos.push(...resultadoParte.productos);
    }
  } else {
    const base64 = buffer.toString('base64');
    let textoRespuesta: string;
    try {
      const vr = await llamarVisionExtraccionJson(
        PROMPT_EXTRACCION_PRECIOS,
        { base64, mimeType },
        { fileName: nombreArchivo },
      );
      textoRespuesta = vr.text;
    } catch (err) {
      throw mapVisionError(err, 'imagen');
    }

    const parsed = intentarParseObjetoJsonModelo(textoRespuesta);
    if (!parsed) {
      throw new UnprocessableEntityException('La IA no devolvi├│ un JSON v├ílido.');
    }

    const resultadoImg = parsed.data as GeminiResult;
    if (!Array.isArray(resultadoImg.productos)) {
      throw new UnprocessableEntityException('La respuesta no contiene un array de productos');
    }
    productosBrutos.push(...resultadoImg.productos);
  }

  return productosAIaItems(productosBrutos);
}
