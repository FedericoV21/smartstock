import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { TenantContext } from '../auth/tenant-context.service';
import { ImportacionLog } from '../importaciones/entities/importacion-log.entity';
import { OrigenPrecio } from '../pricing/enums/origen-precio.enum';
import { AiLimitService } from './ai-limit.service';
import { intentarParseObjetoJsonModelo } from './utils/json-respuesta-ia';
import {
  normalizarProductoDesdeIa,
  type ProductoRawIa,
} from './utils/normalizar-producto-ia.util';
import {
  nombreArchivoChunkPdf,
  paginasPorChunkPdfVision,
  partirPdfParaVisionPorPaginas,
} from './utils/pdf-chunks-vision';
import { PROMPT_EXTRACCION_PRECIOS } from './utils/prompts';
import { esErrorExtraccionVisionIA } from './utils/vision-ia-error';
import { llamarVisionExtraccionJson } from './utils/vision-extraccion';

const MIME_TYPES_PERMITIDOS = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
];
const MAX_FILE_SIZE = 20 * 1024 * 1024;

interface GeminiResult {
  productos: ProductoRawIa[];
}

@Injectable()
export class AiExtractService {
  private readonly logger = new Logger(AiExtractService.name);

  constructor(
    private readonly aiLimitService: AiLimitService,
    @InjectRepository(ImportacionLog)
    private readonly importLogRepo: Repository<ImportacionLog>,
    private readonly tenantContext: TenantContext,
  ) {}

  async extract(file: Express.Multer.File | undefined, user: AccessTokenPayload) {
    const limiteInfo = await this.aiLimitService.verificarLimiteIA('ia_pdf');
    if (!limiteInfo.permitido) {
      throw new HttpException('L├¡mite mensual de extracciones alcanzado', HttpStatus.TOO_MANY_REQUESTS);
    }

    if (!file || !file.buffer?.length) {
      throw new BadRequestException('No se envi├│ ning├║n archivo');
    }
    if (!MIME_TYPES_PERMITIDOS.includes(file.mimetype)) {
      throw new BadRequestException(
        `Formato no soportado: ${file.mimetype}. Us├í PDF, JPG, PNG o WebP.`,
      );
    }
    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException('El archivo no puede superar 20 MB');
    }

    const productosBrutos = await this.extraerProductosBrutos(file);
    const productosNormalizados = productosBrutos
      .map((p) => normalizarProductoDesdeIa(p))
      .filter((p): p is NonNullable<typeof p> => p != null);

    const tenantId = this.tenantContext.getTenantId();
    const usuarioId = user.sub;
    try {
      await this.importLogRepo.save(
        this.importLogRepo.create({
          tenantId,
          proveedorId: null,
          archivoNombre: `[IA extracci├│n] ${file.originalname || 'archivo'}`,
          origen: OrigenPrecio.ia_pdf,
          totalFilas: 0,
          filasExitosas: 0,
          filasConError: 0,
          productosCreados: 0,
          productosActualizados: 0,
          detalleErrores: null,
          usuarioId,
        }),
      );
    } catch (e) {
      this.logger.warn(`importacion_log insert failed: ${(e as Error).message}`);
    }

    return {
      data: {
        productos: productosNormalizados,
        totalExtraidos: productosBrutos.length,
        totalValidos: productosNormalizados.length,
        archivoNombre: file.originalname || 'archivo',
      },
    };
  }

  private async extraerProductosBrutos(file: Express.Multer.File): Promise<ProductoRawIa[]> {
    const productosBrutos: ProductoRawIa[] = [];

    if (file.mimetype === 'application/pdf') {
      const pdfBytes = new Uint8Array(file.buffer);
      const { chunks, totalPages } = await partirPdfParaVisionPorPaginas(pdfBytes);
      this.logger.log(
        `PDF parts=${chunks.length} pages=${totalPages} perChunk=${paginasPorChunkPdfVision()}`,
      );

      for (let ci = 0; ci < chunks.length; ci++) {
        const ch = chunks[ci]!;
        const chunkBase64 = Buffer.from(ch.bytes).toString('base64');
        const chunkLabel =
          chunks.length === 1
            ? file.originalname
            : nombreArchivoChunkPdf(
                file.originalname || 'documento.pdf',
                ch.pageFrom1,
                ch.pageTo1,
                ci + 1,
                chunks.length,
              );

        let textoChunk: string;
        try {
          const vr = await llamarVisionExtraccionJson(
            PROMPT_EXTRACCION_PRECIOS,
            { base64: chunkBase64, mimeType: file.mimetype },
            { fileName: chunkLabel },
          );
          textoChunk = vr.text;
        } catch (err) {
          throw this.mapVisionError(err, `parte ${ci + 1} de ${chunks.length}`);
        }

        const parsed = intentarParseObjetoJsonModelo(textoChunk);
        if (!parsed) {
          throw new HttpException(
            {
              error: `La IA no devolvi├│ JSON v├ílido en la parte ${ci + 1} de ${chunks.length} del PDF.`,
              respuestaRaw: textoChunk.substring(0, 500),
            },
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }

        const resultadoParte = parsed.data as GeminiResult;
        if (!resultadoParte.productos || !Array.isArray(resultadoParte.productos)) {
          throw new HttpException(
            `La respuesta de la parte ${ci + 1} de ${chunks.length} no contiene un array de productos`,
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
        productosBrutos.push(...resultadoParte.productos);
      }
      return productosBrutos;
    }

    const base64 = file.buffer.toString('base64');
    let textoRespuesta: string;
    try {
      const vr = await llamarVisionExtraccionJson(
        PROMPT_EXTRACCION_PRECIOS,
        { base64, mimeType: file.mimetype },
        { fileName: file.originalname },
      );
      textoRespuesta = vr.text;
    } catch (err) {
      throw this.mapVisionError(err, 'imagen');
    }

    const parsed = intentarParseObjetoJsonModelo(textoRespuesta);
    if (!parsed) {
      throw new HttpException(
        {
          error: 'La IA no devolvi├│ un JSON v├ílido.',
          respuestaRaw: textoRespuesta.substring(0, 500),
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const resultadoImg = parsed.data as GeminiResult;
    if (!resultadoImg.productos || !Array.isArray(resultadoImg.productos)) {
      throw new HttpException(
        'La respuesta no contiene un array de productos',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return resultadoImg.productos;
  }

  private mapVisionError(err: unknown, contexto: string): HttpException {
    const e = err as Error;
    if (esErrorExtraccionVisionIA(err) && (err.code === 'api_key' || err.code === 'config')) {
      return new HttpException(err.message, HttpStatus.SERVICE_UNAVAILABLE);
    }
    if (esErrorExtraccionVisionIA(err) && err.code === 'timeout') {
      return new HttpException(err.message, HttpStatus.GATEWAY_TIMEOUT);
    }
    return new HttpException(
      `Error al procesar ${contexto} del archivo: ${e.message || 'Error de IA'}`,
      HttpStatus.BAD_GATEWAY,
    );
  }
}
