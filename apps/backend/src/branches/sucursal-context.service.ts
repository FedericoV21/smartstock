import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Scope,
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { resolveAppRole } from '../auth/utils/resolve-app-role';
import { UsersService } from '../users/users.service';
import { Sucursal } from './entities/sucursal.entity';

type AuthedRequest = Request & { user?: AccessTokenPayload };

export const SUCURSAL_SCOPE_ALL = 'todas';

@Injectable({ scope: Scope.REQUEST })
export class SucursalContext {
  private resolvedId: string | null | undefined;
  private resolvedAllTenant = false;

  constructor(
    @Inject(REQUEST) private readonly request: AuthedRequest,
    @InjectRepository(Sucursal)
    private readonly sucursalRepo: Repository<Sucursal>,
    private readonly tenantContext: TenantContext,
    private readonly usersService: UsersService,
  ) {}

  /** `null` = consolidar todo el tenant (admin + `sucursalId=todas`). */
  getSucursalId(): string | null {
    if (this.resolvedAllTenant) return null;
    if (this.resolvedId !== undefined) return this.resolvedId;
    return null;
  }

  async resolveSucursalId(): Promise<string | null> {
    if (this.resolvedId !== undefined || this.resolvedAllTenant) {
      return this.getSucursalId();
    }

    const tenantId = this.tenantContext.getTenantId();
    const profileDefault = await this.readProfileDefaultSucursalId(tenantId);
    const raw =
      this.readQuerySucursalId() ??
      this.readHeaderSucursalId() ??
      this.readJwtDefaultSucursalId() ??
      profileDefault;

    if (raw && (raw.toLowerCase() === SUCURSAL_SCOPE_ALL || raw === '*')) {
      const role = resolveAppRole(this.userPayload());
      if (role !== 'admin') {
        throw new ForbiddenException(
          'Solo los administradores pueden consolidar reportes de todo el negocio.',
        );
      }
      this.resolvedAllTenant = true;
      this.resolvedId = null;
      return null;
    }

    let sucursalId = raw?.trim() || null;

    if (!sucursalId) {
      const role = resolveAppRole(this.userPayload());
      if (role === 'admin') {
        sucursalId = await this.principalOrFirstActiveId(tenantId);
      }
    }

    if (!sucursalId) {
      this.resolvedId = null;
      return null;
    }

    const row = await this.sucursalRepo.findOne({
      where: { id: sucursalId, tenantId, activa: true },
    });
    if (!row) {
      if (raw) {
        throw new NotFoundException('Sucursal no encontrada o inactiva.');
      }
      const fallback = await this.principalOrFirstActiveId(tenantId);
      this.resolvedId = fallback;
      return fallback;
    }

    this.resolvedId = row.id;
    return row.id;
  }

  async requireSucursalId(): Promise<string> {
    const id = await this.resolveSucursalId();
    if (!id) {
      throw new BadRequestException(
        'Indic├í sucursalId (query/header X-Sucursal-Id) o eleg├¡ sucursal activa en tu perfil.',
      );
    }
    return id;
  }

  setActiveSucursalId(sucursalId: string): void {
    this.resolvedAllTenant = false;
    this.resolvedId = sucursalId;
  }

  getJwtDefaultSucursalId(): string | null {
    return this.readJwtDefaultSucursalId();
  }

  private async readProfileDefaultSucursalId(tenantId: string): Promise<string | null> {
    const sub = this.request.user?.sub;
    if (typeof sub !== 'string' || !sub.trim()) {
      return null;
    }
    return this.usersService.getSucursalDefaultId(sub, tenantId);
  }

  private userPayload(): AccessTokenPayload {
    return (this.request.user ?? { sub: '' }) as AccessTokenPayload;
  }

  private readQuerySucursalId(): string | null {
    const q = this.request.query?.sucursalId ?? this.request.query?.sucursal_id;
    if (typeof q === 'string' && q.trim()) return q.trim();
    return null;
  }

  private readHeaderSucursalId(): string | null {
    const h = this.request.headers['x-sucursal-id'];
    if (typeof h === 'string' && h.trim()) return h.trim();
    return null;
  }

  private readJwtDefaultSucursalId(): string | null {
    const claim =
      this.request.user?.sucursal_default_id ?? this.request.user?.sucursalDefaultId;
    if (typeof claim === 'string' && claim.trim()) return claim.trim();
    return null;
  }

  private async principalOrFirstActiveId(tenantId: string): Promise<string | null> {
    const rows = await this.sucursalRepo.find({
      where: { tenantId, activa: true },
      order: { esPrincipal: 'DESC', createdAt: 'ASC' },
      take: 1,
    });
    return rows[0]?.id ?? null;
  }
}
