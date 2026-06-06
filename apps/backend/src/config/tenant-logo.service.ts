import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { Tenant } from './entities/tenant.entity';
import {
  TENANT_LOGO_ALLOWED_MIMES,
  TENANT_LOGO_MAX_BYTES,
  TenantLogoStorageService,
} from './storage/tenant-logo.storage';

@Injectable()
export class TenantLogoService {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly storage: TenantLogoStorageService,
    private readonly tenantContext: TenantContext,
  ) {}

  async uploadLogo(file: Express.Multer.File | undefined) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Archivo requerido');
    }

    const mime = file.mimetype || 'application/octet-stream';
    if (!TENANT_LOGO_ALLOWED_MIMES.has(mime)) {
      throw new BadRequestException('Formato no permitido. Us├í PNG, JPG o WebP.');
    }
    if (file.size > TENANT_LOGO_MAX_BYTES) {
      throw new BadRequestException('El archivo supera 2 MB');
    }

    if (!this.storage.isConfigured()) {
      throw new ServiceUnavailableException(
        'Storage de logos no configurado (TENANT_LOGO_STORAGE_ENABLED o PRODUCT_IMAGE_STORAGE_ENABLED + credenciales S3).',
      );
    }

    const tenantId = this.tenantContext.getTenantId();
    const logoUrl = await this.storage.uploadLogo(tenantId, file.buffer, mime);

    await this.tenantRepo.update({ id: tenantId }, { logoUrl });
    return { logo_url: logoUrl };
  }

  async deleteLogo() {
    const tenantId = this.tenantContext.getTenantId();
    if (this.storage.isConfigured()) {
      await this.storage.deleteLogo(tenantId);
    }
    await this.tenantRepo.update({ id: tenantId }, { logoUrl: null });
    return { logo_url: null };
  }
}
