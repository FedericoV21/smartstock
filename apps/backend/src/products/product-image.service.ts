import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { Producto } from './entities/producto.entity';
import { ProductImageS3StorageService } from './storage/product-image-s3.storage';
import {
  assertProductImageMime,
  assertProductImageSize,
  processProductImagePreview,
} from './utils/process-product-image';

@Injectable()
export class ProductImageService {
  constructor(
    @InjectRepository(Producto)
    private readonly productoRepo: Repository<Producto>,
    private readonly imageStorage: ProductImageS3StorageService,
    private readonly tenantContext: TenantContext,
  ) {}

  async upload(productId: string, file: Express.Multer.File) {
    if (!this.imageStorage.isConfigured()) {
      throw new ServiceUnavailableException(
        'Storage de im├ígenes no configurado (PRODUCT_IMAGE_STORAGE_ENABLED y credenciales S3/R2)',
      );
    }

    if (!file?.buffer?.length) {
      throw new BadRequestException('Archivo requerido');
    }

    try {
      assertProductImageMime(file.mimetype);
      assertProductImageSize(file.size);
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      if (code === 'FORMATO_NO_PERMITIDO') {
        throw new BadRequestException('Formato no permitido. Us├í PNG, JPG o WebP.');
      }
      if (code === 'ARCHIVO_DEMASIADO_GRANDE') {
        throw new BadRequestException('El archivo supera 2 MB');
      }
      throw err;
    }

    const tenantId = this.tenantContext.getTenantId();
    const producto = await this.productoRepo.findOne({
      where: { id: productId, tenantId, activo: true },
    });
    if (!producto) {
      throw new NotFoundException('Producto no encontrado');
    }

    let webp: Buffer;
    try {
      webp = await processProductImagePreview(file.buffer);
    } catch {
      throw new BadRequestException('No se pudo procesar la imagen. Prob├í con otra foto.');
    }

    const imagenUrl = await this.imageStorage.uploadPreview(tenantId, productId, webp);
    producto.imagenUrl = imagenUrl;

    try {
      const saved = await this.productoRepo.save(producto);
      return { data: { imagenUrl: saved.imagenUrl } };
    } catch {
      throw new BadRequestException('No se pudo guardar la imagen del producto');
    }
  }

  async remove(productId: string) {
    const tenantId = this.tenantContext.getTenantId();
    const producto = await this.productoRepo.findOne({
      where: { id: productId, tenantId, activo: true },
    });
    if (!producto) {
      throw new NotFoundException('Producto no encontrado');
    }

    if (this.imageStorage.isConfigured()) {
      await this.imageStorage.deletePreview(tenantId, productId);
    }

    producto.imagenUrl = null;
    await this.productoRepo.save(producto);
    return { data: { imagenUrl: null } };
  }
}
