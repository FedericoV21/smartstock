import { BadRequestException, Injectable, UnprocessableEntityException } from '@nestjs/common';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { LectorFacturasBaseService } from './lector-facturas-base.service';
import { extraerTablaFacturaConOcr } from './utils/ocr-tabla.util';

const MIME_TYPES_PERMITIDOS = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_FILE_SIZE = 12 * 1024 * 1024;

@Injectable()
export class LectorFacturasTablaOcrService {
  constructor(private readonly base: LectorFacturasBaseService) {}

  async extraer(file: Express.Multer.File | undefined, user: AccessTokenPayload) {
    await this.base.assertModuloLector();
    this.base.assertNotVisor(user);

    if (!file || !file.buffer?.length) {
      throw new BadRequestException('Imagen requerida');
    }
    if (!MIME_TYPES_PERMITIDOS.has(file.mimetype)) {
      throw new BadRequestException(
        `Formato no soportado: ${file.mimetype || 'desconocido'}. Usa JPG, PNG o WebP.`,
      );
    }
    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException('La imagen no puede superar 12 MB');
    }

    try {
      return await extraerTablaFacturaConOcr({
        bytes: new Uint8Array(file.buffer),
        mimeType: file.mimetype,
        archivoNombre: file.originalname || 'factura.jpg',
      });
    } catch (e) {
      throw new UnprocessableEntityException((e as Error).message || 'No se pudo leer la tabla con OCR');
    }
  }
}
