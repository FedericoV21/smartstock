import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AiLimitService } from '../../ai/ai-limit.service';
import { TenantContext } from '../../auth/tenant-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/access-token-payload.interface';
import { Proveedor } from '../../catalog/entities/proveedor.entity';
import { ModuloConfig } from '../../config/entities/modulo-config.entity';
import { ImportacionLog } from '../../importaciones/entities/importacion-log.entity';
import { OrigenPrecio } from '../../pricing/enums/origen-precio.enum';
import { PriceListFileStorage } from './storage/price-list-file.storage';
import type { ResultadoExtraccionLista } from './types/item-extraido-lista.type';
import {
  MAX_ARCHIVO_LISTA_BYTES,
  MIME_EXCEL_LISTA,
  MIME_TODOS_LISTA,
} from './utils/extraer-lista.constants';
import { extraerItemsExcel } from './utils/extraer-lista-excel.util';
import { extraerItemsListaConVision } from './utils/extraer-items-lista-ia.util';

@Injectable()
export class PriceListPreviewService {
  constructor(
    @InjectRepository(Proveedor)
    private readonly proveedorRepo: Repository<Proveedor>,
    @InjectRepository(ModuloConfig)
    private readonly moduloRepo: Repository<ModuloConfig>,
    @InjectRepository(ImportacionLog)
    private readonly importLogRepo: Repository<ImportacionLog>,
    private readonly tenantContext: TenantContext,
    private readonly aiLimitService: AiLimitService,
    private readonly fileStorage: PriceListFileStorage,
  ) {}

  async preview(
    user: AccessTokenPayload,
    file: Express.Multer.File | undefined,
    proveedorId: string,
  ): Promise<ResultadoExtraccionLista> {
    await this.assertImportadorExcel();

    if (!file?.buffer?.length) {
      throw new BadRequestException('No se envi├│ ning├║n archivo');
    }
    if (!proveedorId?.trim()) {
      throw new BadRequestException('proveedor_id es obligatorio');
    }

    const mimeType = file.mimetype || 'application/octet-stream';
    if (!(MIME_TODOS_LISTA as readonly string[]).includes(mimeType)) {
      throw new BadRequestException(
        `Formato no soportado: ${mimeType}. Us├í PDF, Excel, CSV, JPG, PNG o WebP.`,
      );
    }
    if (file.size > MAX_ARCHIVO_LISTA_BYTES) {
      throw new BadRequestException('El archivo no puede superar 20 MB');
    }

    const tenantId = this.tenantContext.getTenantId();
    const proveedor = await this.proveedorRepo.findOne({
      where: { tenantId, id: proveedorId.trim() },
      select: { id: true },
    });
    if (!proveedor) {
      throw new NotFoundException('Proveedor no encontrado');
    }

    const modulos = await this.moduloRepo.findOne({ where: { tenantId } });
    const esExcel = (MIME_EXCEL_LISTA as readonly string[]).includes(mimeType);
    const nombreArchivo = file.originalname || 'lista';
    const buffer = file.buffer;

    let items;
    let iaUsada = false;

    try {
      if (esExcel) {
        items = extraerItemsExcel(buffer, nombreArchivo);
      } else {
        if (!modulos?.iaPrecios) {
          throw new BadRequestException('La carga de listas desde PDF o imagen requiere el m├│dulo IA.');
        }
        const limite = await this.aiLimitService.verificarLimiteIA('ia_pdf');
        if (!limite.permitido) {
          throw new HttpException(
            {
              error: 'L├¡mite mensual de extracciones IA alcanzado',
              usadas: limite.usadas,
              limite: limite.limite,
            },
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
        items = await extraerItemsListaConVision(buffer, mimeType, nombreArchivo);
        iaUsada = true;
        await this.importLogRepo.save(
          this.importLogRepo.create({
            tenantId,
            proveedorId: null,
            archivoNombre: `[IA lista] ${nombreArchivo}`,
            origen: OrigenPrecio.ia_pdf,
            totalFilas: 0,
            filasExitosas: 0,
            filasConError: 0,
            productosCreados: 0,
            productosActualizados: 0,
            detalleErrores: null,
            usuarioId: user.sub,
          }),
        );
      }
    } catch (e) {
      if (e instanceof HttpException || e instanceof BadRequestException) throw e;
      const msg = (e as Error).message || 'Error al extraer items';
      throw new UnprocessableEntityException(msg);
    }

    if (items.length === 0) {
      throw new UnprocessableEntityException('No se pudo extraer ning├║n item v├ílido del archivo');
    }

    const storagePath = await this.fileStorage.upload(tenantId, buffer, nombreArchivo, mimeType);
    const descuento = 0;

    return {
      items,
      storage_path: storagePath,
      nombre_archivo: nombreArchivo,
      mime_type: mimeType,
      origen: esExcel ? 'importacion_excel' : 'ia_pdf',
      ia_usada: iaUsada,
      descuento_proveedor_default: descuento,
    };
  }

  private async assertImportadorExcel(): Promise<void> {
    const modulos = await this.moduloRepo.findOne({
      where: { tenantId: this.tenantContext.getTenantId() },
    });
    if (!modulos?.importadorExcel) {
      throw new ForbiddenException("El m├│dulo 'importador_excel' no est├í habilitado para tu plan.");
    }
  }
}
