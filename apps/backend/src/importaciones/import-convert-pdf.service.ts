import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { convertirPdfTextoATabla } from './utils/pdf-a-tabla';
import { PDF_TO_TABLE_MAX_BYTES, PDF_TO_TABLE_MAX_MB } from './utils/pdf-upload-limits';

@Injectable()
export class ImportConvertPdfService {
  constructor(
    @InjectRepository(ModuloConfig)
    private readonly moduloConfigRepo: Repository<ModuloConfig>,
    private readonly tenantContext: TenantContext,
  ) {}

  async convert(file: Express.Multer.File | undefined) {
    await this.assertModuleAllowed();

    if (!file || !file.buffer?.length) {
      throw new BadRequestException('Archivo PDF requerido');
    }

    if (file.size > PDF_TO_TABLE_MAX_BYTES) {
      throw new BadRequestException(`El PDF no puede superar ${PDF_TO_TABLE_MAX_MB} MB`);
    }

    const lower = (file.originalname || '').toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();
    if (mime !== 'application/pdf' && !lower.endsWith('.pdf')) {
      throw new BadRequestException('Solo se aceptan archivos PDF');
    }

    try {
      const bytes = new Uint8Array(file.buffer);
      const { headers, filas, totalFilas } = await convertirPdfTextoATabla(bytes);
      return {
        data: {
          headers,
          filas,
          totalFilas,
          archivoNombre: file.originalname || 'documento.pdf',
        },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error al leer el PDF';
      throw new BadRequestException(msg);
    }
  }

  private async assertModuleAllowed(): Promise<void> {
    const tenantId = this.tenantContext.getTenantId();
    const modulos = await this.moduloConfigRepo.findOne({ where: { tenantId } });
    if (!modulos) {
      throw new ForbiddenException('Configuraci├│n de m├│dulos no encontrada');
    }
    if (!modulos.importadorExcel && !modulos.iaPrecios) {
      throw new ForbiddenException('M├│dulo de importaci├│n o IA precios no habilitado');
    }
  }
}
