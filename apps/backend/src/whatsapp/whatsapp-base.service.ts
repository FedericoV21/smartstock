import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { resolveAppRole } from '../auth/utils/resolve-app-role';
import { TenantContext } from '../auth/tenant-context.service';
import { ModuloConfig } from '../config/entities/modulo-config.entity';

@Injectable()
export class WhatsappBaseService {
  constructor(
    @InjectRepository(ModuloConfig) private readonly moduloRepo: Repository<ModuloConfig>,
    private readonly tenantContext: TenantContext,
  ) {}

  getTenantId(): string {
    return this.tenantContext.getTenantId();
  }

  async assertModuloWhatsApp(): Promise<void> {
    const mod = await this.moduloRepo.findOne({
      where: { tenantId: this.tenantContext.getTenantId() },
    });
    if (!mod?.lectorFacturas && !mod?.importadorExcel) {
      throw new ForbiddenException('Módulo WhatsApp no habilitado (lector_facturas o importador_excel)');
    }
  }

  isSuperAdmin(user: AccessTokenPayload): boolean {
    return user.es_super_admin === true || user.isSuperAdmin === true;
  }

  isAdminOrSuper(user: AccessTokenPayload): boolean {
    return this.isSuperAdmin(user) || resolveAppRole(user) === 'admin';
  }

  assertAdminOrSuper(user: AccessTokenPayload): void {
    if (!this.isAdminOrSuper(user)) {
      throw new ForbiddenException('Solo admin/super-admin puede realizar esta acción');
    }
  }

  assertSuperAdmin(user: AccessTokenPayload): void {
    if (!this.isSuperAdmin(user)) {
      throw new ForbiddenException(
        'Solo super admin puede configurar el canal WhatsApp central de SmartStock.',
      );
    }
  }

  assertNotVisor(user: AccessTokenPayload): void {
    if (resolveAppRole(user) === 'visor') {
      throw new ForbiddenException('Los usuarios visor no pueden modificar configuración WhatsApp');
    }
  }
}
