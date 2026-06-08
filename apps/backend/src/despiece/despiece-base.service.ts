import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { TenantContext } from '../auth/tenant-context.service';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { SucursalContext } from '../branches/sucursal-context.service';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { Tenant } from '../config/entities/tenant.entity';
import { effectiveBusinessPrefsFromRows } from '../config/utils/business-prefs.util';
import { PermisosEvalService } from '../rbac/permisos-eval.service';

@Injectable()
export class DespieceBaseService {
  constructor(
    @InjectRepository(ModuloConfig) private readonly moduloRepo: Repository<ModuloConfig>,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(Sucursal) private readonly sucursalRepo: Repository<Sucursal>,
    private readonly tenantContext: TenantContext,
    private readonly sucursalContext: SucursalContext,
    private readonly permisosEval: PermisosEvalService,
  ) {}

  getTenantId(): string {
    return this.tenantContext.getTenantId();
  }

  async assertModuloDespiece(): Promise<void> {
    const tenantId = this.getTenantId();
    const mod = await this.moduloRepo.findOne({ where: { tenantId } });
    if (!mod?.despieceCarniceria) {
      throw new ForbiddenException(
        "El módulo 'despiece_carniceria' no está habilitado para tu plan.",
      );
    }

    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) {
      throw new ForbiddenException('Tenant no encontrado.');
    }

    let sucursalPrefs: unknown = null;
    const sucursalId = await this.sucursalContext.resolveSucursalId().catch(() => null);
    if (sucursalId) {
      const sucursal = await this.sucursalRepo.findOne({ where: { id: sucursalId, tenantId } });
      sucursalPrefs = sucursal?.businessPrefs ?? null;
    }

    const effective = effectiveBusinessPrefsFromRows(tenant.businessPrefs, sucursalPrefs);
    if (!effective.despieceCarniceriaHabilitado) {
      throw new ForbiddenException('El módulo de despiece no está habilitado en preferencias de negocio.');
    }
  }

  async assertPermisoVer(user: AccessTokenPayload): Promise<void> {
    const ok = await this.permisosEval.hasPermiso(user, this.getTenantId(), 'despiece.ver');
    if (!ok) throw new ForbiddenException('Sin permisos para ver despiece.');
  }

  async assertPermisoEditar(user: AccessTokenPayload): Promise<void> {
    const ok = await this.permisosEval.hasPermiso(user, this.getTenantId(), 'despiece.editar');
    if (!ok) throw new ForbiddenException('Sin permisos para editar despiece.');
  }

  async assertPermisoAplicarPrecios(user: AccessTokenPayload): Promise<void> {
    const ok = await this.permisosEval.hasPermiso(
      user,
      this.getTenantId(),
      'despiece.aplicar_precios',
    );
    if (!ok) throw new ForbiddenException('Sin permisos para aplicar precios de despiece.');
  }

  async resolveSucursalId(param?: string | null): Promise<string> {
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
