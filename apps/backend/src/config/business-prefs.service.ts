import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { Tenant } from './entities/tenant.entity';
import type { PatchBusinessPrefsDto } from './dto/business-prefs.dto';
import {
  effectiveBusinessPrefsFromRows,
  isBusinessPrefsPayload,
  mergeBusinessPrefsOverride,
  normalizeBusinessPrefs,
  type BusinessPrefs,
} from './utils/business-prefs.util';

@Injectable()
export class BusinessPrefsService {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(Sucursal)
    private readonly sucursalRepo: Repository<Sucursal>,
    private readonly tenantContext: TenantContext,
  ) {}

  async getBusinessPrefs(forConfig: boolean, requestedSucursalId?: string | null) {
    const tenantId = this.tenantContext.getTenantId();
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) {
      throw new NotFoundException('Tenant no encontrado');
    }

    const tenantNorm = normalizeBusinessPrefs(tenant.businessPrefs);
    let sucursalPrefsRaw: unknown | null = null;
    let outSucursalId: string | null = null;

    if (forConfig) {
      if (requestedSucursalId) {
        const sucursal = await this.sucursalRepo.findOne({
          where: { id: requestedSucursalId, tenantId },
        });
        if (!sucursal) {
          throw new NotFoundException('Sucursal no encontrada.');
        }
        outSucursalId = requestedSucursalId;
        sucursalPrefsRaw = sucursal.businessPrefs ?? null;
      }
    } else if (requestedSucursalId) {
      const sucursal = await this.sucursalRepo.findOne({
        where: { id: requestedSucursalId, tenantId },
      });
      if (sucursal) {
        outSucursalId = requestedSucursalId;
        sucursalPrefsRaw = sucursal.businessPrefs ?? null;
      }
    }

    const effective = effectiveBusinessPrefsFromRows(tenant.businessPrefs, sucursalPrefsRaw);

    return {
      sucursal_id: outSucursalId,
      tenant_business_prefs: tenantNorm,
      sucursal_business_prefs: outSucursalId ? sucursalPrefsRaw : null,
      effective_business_prefs: effective,
    };
  }

  async patchBusinessPrefs(dto: PatchBusinessPrefsDto, appRole: string | undefined) {
    const tenantId = this.tenantContext.getTenantId();

    if (dto.scope === 'tenant') {
      if (appRole !== 'admin') {
        throw new ForbiddenException('Solo el administrador puede editar los defaults del negocio.');
      }
      if (!isBusinessPrefsPayload(dto.business_prefs)) {
        throw new BadRequestException('business_prefs inv├ílido.');
      }
      const normalized = normalizeBusinessPrefs(dto.business_prefs as Partial<BusinessPrefs>);
      const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
      if (!tenant) throw new NotFoundException('Tenant no encontrado');
      tenant.businessPrefs = normalized as unknown as Record<string, unknown>;
      await this.tenantRepo.save(tenant);
      return { ok: true, business_prefs: normalized };
    }

    const sucursalId = dto.sucursal_id?.trim();
    if (!sucursalId) {
      throw new BadRequestException(
        'Us├í scope "tenant" + business_prefs, o sucursal_id + business_prefs / inherit_from_tenant.',
      );
    }

    if (appRole !== 'admin') {
      throw new ForbiddenException('Sin permisos para editar sucursales.');
    }

    const sucursal = await this.sucursalRepo.findOne({ where: { id: sucursalId, tenantId } });
    if (!sucursal) {
      throw new NotFoundException('Sucursal no encontrada.');
    }

    if (dto.inherit_from_tenant === true) {
      sucursal.businessPrefs = null;
      await this.sucursalRepo.save(sucursal);
      return { ok: true, business_prefs: null };
    }

    if (!isBusinessPrefsPayload(dto.business_prefs)) {
      throw new BadRequestException('business_prefs inv├ílido.');
    }

    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    const tenantNorm = normalizeBusinessPrefs(tenant?.businessPrefs);
    const merged = mergeBusinessPrefsOverride(tenantNorm, dto.business_prefs as Partial<BusinessPrefs>);
    const sameAsTenant = JSON.stringify(merged) === JSON.stringify(tenantNorm);
    const valueToStore = sameAsTenant ? null : merged;

    sucursal.businessPrefs = valueToStore as unknown as Record<string, unknown> | null;
    await this.sucursalRepo.save(sucursal);
    return { ok: true, business_prefs: valueToStore };
  }
}
