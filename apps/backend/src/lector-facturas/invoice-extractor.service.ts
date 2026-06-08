import {
  BadRequestException,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { Repository } from 'typeorm';

import { ApiExtractorAuthService } from './api-extractor-auth.service';
import { FacturaExtractorLog } from './entities/factura-extractor-log.entity';
import {
  archivosDesdeExtractorJson,
  extraerFacturaIaPura,
  validarArchivosFacturaIa,
} from './utils/extraer-factura-ia-pura.util';

@Injectable()
export class InvoiceExtractorService {
  constructor(
    private readonly auth: ApiExtractorAuthService,
    @InjectRepository(FacturaExtractorLog)
    private readonly logRepo: Repository<FacturaExtractorLog>,
  ) {}

  private async insertLog(params: {
    keyId: string;
    archivoNombre: string | null;
    archivoMime: string | null;
    archivoTamano: number | null;
    estado: 'extraido' | 'error';
    errorCode?: string | null;
    errorDetail?: string | null;
    duracionMs: number;
    meta?: Record<string, unknown> | null;
  }) {
    await this.logRepo.save({
      apiKeyId: params.keyId,
      archivoNombre: params.archivoNombre,
      archivoMime: params.archivoMime,
      archivoTamano: params.archivoTamano != null ? String(params.archivoTamano) : null,
      estado: params.estado,
      errorCode: params.errorCode ?? null,
      errorDetail: params.errorDetail ?? null,
      duracionMs: params.duracionMs,
      meta: params.meta ?? null,
    });
  }

  async extract(request: Request, body: unknown) {
    const started = Date.now();
    const { key } = await this.auth.authenticate({
      request,
      scope: 'invoice:extract',
    });

    const archivos = archivosDesdeExtractorJson(body);
    if (!archivos) {
      throw new BadRequestException('JSON invalido');
    }

    const validacion = validarArchivosFacturaIa(archivos);
    if (!validacion.ok) {
      await this.insertLog({
        keyId: key.id,
        archivoNombre: archivos[0]?.name ?? null,
        archivoMime: archivos[0]?.type ?? null,
        archivoTamano: archivos.reduce((acc, a) => acc + a.size, 0),
        estado: 'error',
        errorCode: `http_${validacion.status}`,
        errorDetail: validacion.error,
        duracionMs: Date.now() - started,
      });
      throw new HttpException(validacion.error, validacion.status);
    }

    const result = await extraerFacturaIaPura({
      archivos,
      source: 'extractor_publico',
    });

    if (!result.ok) {
      await this.insertLog({
        keyId: key.id,
        archivoNombre: result.archivoNombre ?? archivos[0]?.name ?? null,
        archivoMime:
          result.archivoMime ?? (archivos.length === 1 ? (archivos[0]?.type ?? null) : 'multipart/mixed'),
        archivoTamano: result.archivoTamano ?? validacion.totalBytes,
        estado: 'error',
        errorCode: `http_${result.status}`,
        errorDetail: result.error,
        duracionMs: Date.now() - started,
        meta: result.meta ? { ia: result.meta } : null,
      });
      throw new HttpException(
        {
          error: result.error,
          ...(result.respuesta_raw ? { respuesta_raw: result.respuesta_raw } : {}),
        },
        result.status,
      );
    }

    await this.insertLog({
      keyId: key.id,
      archivoNombre: result.archivoNombre,
      archivoMime: result.archivoMime,
      archivoTamano: result.archivoTamano,
      estado: 'extraido',
      duracionMs: Date.now() - started,
      meta: {
        total_hojas: result.hojasResumen.length,
        reintento_usado: result.resultadosFinales === result.resultadosReintento,
      },
    });

    return result.clean;
  }
}
