import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { memoryStorage } from 'multer';

import { Public } from '../auth/decorators/public.decorator';
import { LectorFacturasJobsService } from './lector-facturas-jobs.service';
import type { ArchivoFacturaEntrada } from './utils/extraer-factura-ia-pura.util';

const MAX_FILE_SIZE = 20 * 1024 * 1024;

function stringValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t || null;
}

function archivoDesdeJsonRow(row: unknown, idx: number): ArchivoFacturaEntrada | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const r = row as Record<string, unknown>;
  const base64 = stringValue(r.base64 ?? r.data_base64 ?? r.contenido_base64);
  const mimeType = stringValue(r.mime_type ?? r.mimeType ?? r.type);
  if (!base64 || !mimeType) return null;
  const nombre = stringValue(r.nombre ?? r.name ?? r.filename) ?? `factura-${idx + 1}`;
  const clean = base64.replace(/^data:[^;]+;base64,/i, '').replace(/\s+/g, '');
  const bytes = new Uint8Array(Buffer.from(clean, 'base64'));
  if (bytes.byteLength === 0) return null;
  return { name: nombre, type: mimeType, size: bytes.byteLength, bytes };
}

@ApiTags('public-lector-facturas')
@Public()
@Controller('public/lector-facturas/jobs')
export class LectorFacturasPublicController {
  constructor(private readonly jobsService: LectorFacturasJobsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiHeader({ name: 'Authorization', required: false })
  @ApiHeader({ name: 'X-Api-Key', required: false })
  @ApiOperation({ summary: 'Crear job async lector (API key)' })
  @UseInterceptors(
    FilesInterceptor('archivo', 10, {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE },
    }),
  )
  async crearJob(
    @Req() request: Request,
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: Record<string, unknown>,
  ) {
    const contentType = request.headers['content-type']?.toLowerCase() ?? '';
    let archivos: ArchivoFacturaEntrada[] = [];
    let externalId: string | null = null;
    let idempotencyKey: string | null = null;
    let callbackUrl: string | null = null;

    if (contentType.includes('multipart/form-data')) {
      archivos = (files ?? []).map((file, i) => ({
        name: file.originalname || `factura-${i + 1}`,
        type: file.mimetype,
        size: file.size,
        bytes: new Uint8Array(file.buffer),
      }));
      externalId = stringValue(body.external_id);
      idempotencyKey = stringValue(body.idempotency_key);
      callbackUrl = stringValue(body.callback_url);
    } else {
      const rows = Array.isArray(body.archivos)
        ? body.archivos
        : Array.isArray(body.files)
          ? body.files
          : body.archivo_base64 || body.base64
            ? [
                {
                  base64: body.archivo_base64 ?? body.base64,
                  mime_type: body.mime_type ?? body.mimeType,
                  nombre: body.nombre ?? body.filename,
                },
              ]
            : [];
      archivos = rows
        .map((row, idx) => archivoDesdeJsonRow(row, idx))
        .filter((item): item is ArchivoFacturaEntrada => item != null);
      externalId = stringValue(body.external_id);
      idempotencyKey =
        request.headers['idempotency-key']?.toString().trim() ||
        stringValue(body.idempotency_key);
      callbackUrl = stringValue(body.callback_url);
    }

    const proto = request.headers['x-forwarded-proto'] ?? 'http';
    const host = request.headers.host ?? 'localhost';
    const statusUrlBase = `${proto}://${host}/api/v1/public/lector-facturas/jobs`;

    return this.jobsService.crearJob({
      request,
      archivos,
      externalId,
      idempotencyKey,
      callbackUrl,
      statusUrlBase,
    });
  }

  @Get(':id')
  @ApiHeader({ name: 'Authorization', required: false })
  @ApiHeader({ name: 'X-Api-Key', required: false })
  @ApiOperation({ summary: 'Estado job lector (API key)' })
  getJob(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string) {
    return this.jobsService.getJob({ request, jobId: id });
  }

  @Post(':id/confirmar')
  @ApiHeader({ name: 'Authorization', required: false })
  @ApiHeader({ name: 'X-Api-Key', required: false })
  @ApiOperation({ summary: 'Confirmar job completado (API key)' })
  confirmarJob(
    @Req() request: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.jobsService.confirmarJob({ request, jobId: id, body });
  }
}
