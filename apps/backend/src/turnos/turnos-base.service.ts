import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { resolveAppRole } from '../auth/utils/resolve-app-role';
import { TenantContext } from '../auth/tenant-context.service';
import { SucursalContext } from '../branches/sucursal-context.service';
import { ModuloConfig } from '../config/entities/modulo-config.entity';

@Injectable()
export class TurnosBaseService {
  constructor(
    @InjectRepository(ModuloConfig) private readonly moduloRepo: Repository<ModuloConfig>,
    private readonly tenantContext: TenantContext,
    private readonly sucursalContext: SucursalContext,
  ) {}

  getTenantId(): string {
    return this.tenantContext.getTenantId();
  }

  async assertModuloTurnos(): Promise<void> {
    const mod = await this.moduloRepo.findOne({
      where: { tenantId: this.tenantContext.getTenantId() },
    });
    if (!mod?.turnos) {
      throw new ForbiddenException('Módulo turnos no habilitado');
    }
  }

  async assertFacturadorSimple(): Promise<void> {
    const mod = await this.moduloRepo.findOne({
      where: { tenantId: this.tenantContext.getTenantId() },
    });
    if (!mod?.facturadorSimple) {
      throw new ForbiddenException('Módulo facturador_simple no habilitado');
    }
  }

  async assertFacturadorPos(): Promise<void> {
    const mod = await this.moduloRepo.findOne({
      where: { tenantId: this.tenantContext.getTenantId() },
    });
    if (!mod?.facturadorPos) {
      throw new ForbiddenException('Módulo facturador_pos no habilitado');
    }
  }

  assertNotVisor(user: AccessTokenPayload): void {
    if (resolveAppRole(user) === 'visor') {
      throw new ForbiddenException('Los usuarios visor no pueden modificar turnos');
    }
  }

  async resolveSucursalId(param?: string): Promise<string> {
    if (param?.trim()) {
      this.sucursalContext.setActiveSucursalId(param.trim());
    }
    const id = await this.sucursalContext.resolveSucursalId();
    if (!id) {
      throw new BadRequestException('No hay sucursal operativa seleccionada.');
    }
    return id;
  }
}
