import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { resolveAppRole } from '../auth/utils/resolve-app-role';
import { TenantContext } from '../auth/tenant-context.service';
import { ModuloConfig } from '../config/entities/modulo-config.entity';

@Injectable()
export class LectorFacturasBaseService {
  constructor(
    @InjectRepository(ModuloConfig) private readonly moduloRepo: Repository<ModuloConfig>,
    private readonly tenantContext: TenantContext,
  ) {}

  getTenantId(): string {
    return this.tenantContext.getTenantId();
  }

  async assertModuloLector(): Promise<void> {
    const mod = await this.moduloRepo.findOne({
      where: { tenantId: this.tenantContext.getTenantId() },
    });
    if (!mod?.lectorFacturas && !mod?.facturadorSimple) {
      throw new ForbiddenException(
        'Módulo lector de facturas no habilitado (lector_facturas o facturador_simple)',
      );
    }
  }

  isSuperAdmin(user: AccessTokenPayload): boolean {
    return user.es_super_admin === true || user.isSuperAdmin === true;
  }

  isAdminOrSuper(user: AccessTokenPayload): boolean {
    return this.isSuperAdmin(user) || resolveAppRole(user) === 'admin';
  }

  assertNotVisor(user: AccessTokenPayload): void {
    if (resolveAppRole(user) === 'visor') {
      throw new ForbiddenException('Los usuarios visor no pueden modificar borradores del lector');
    }
  }
}
