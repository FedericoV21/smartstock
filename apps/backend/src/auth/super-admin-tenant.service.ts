import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { Tenant } from '../config/entities/tenant.entity';
import { Usuario } from '../users/entities/usuario.entity';
import { SuperAdminContextoLog } from './entities/super-admin-contexto-log.entity';
import { SuperAdminTenantAcceso } from './entities/super-admin-tenant-acceso.entity';

@Injectable()
export class SuperAdminTenantService {
  constructor(
    @InjectRepository(Usuario)
    private readonly usuarioRepo: Repository<Usuario>,
    @InjectRepository(SuperAdminTenantAcceso)
    private readonly accesoRepo: Repository<SuperAdminTenantAcceso>,
    @InjectRepository(SuperAdminContextoLog)
    private readonly logRepo: Repository<SuperAdminContextoLog>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
  ) {}

  async findUsuarioById(userId: string): Promise<Usuario | null> {
    return this.usuarioRepo.findOne({ where: { id: userId, activo: true } });
  }

  async hasAcceso(usuarioId: string, tenantId: string): Promise<boolean> {
    return this.accesoRepo.exist({ where: { usuarioId, tenantId } });
  }

  /**
   * Resuelve tenant efectivo: header X-Tenant-Id (super-admin) > contexto DB > JWT (hook).
   */
  async resolveEffectiveTenantId(params: {
    userId: string;
    jwtTenantId: string | undefined;
    headerTenantId?: string | null;
  }): Promise<string | null> {
    const usuario = await this.findUsuarioById(params.userId);
    if (!usuario) {
      const jwt = params.jwtTenantId?.trim();
      return jwt || null;
    }

    const home = usuario.tenantId;
    const jwt = params.jwtTenantId?.trim() || '';
    const header = params.headerTenantId?.trim();

    if (header) {
      if (header === home) {
        return home;
      }
      if (!usuario.esSuperAdmin) {
        throw new ForbiddenException('Sin permisos');
      }
      if (await this.hasAcceso(usuario.id, header)) {
        return header;
      }
      throw new ForbiddenException('Sin acceso a este negocio');
    }

    if (
      usuario.esSuperAdmin &&
      usuario.tenantContextoId &&
      usuario.tenantContextoId !== home
    ) {
      if (await this.hasAcceso(usuario.id, usuario.tenantContextoId)) {
        return usuario.tenantContextoId;
      }
    }

    if (jwt) {
      if (jwt === home || !usuario.esSuperAdmin) {
        return jwt;
      }
      if (await this.hasAcceso(usuario.id, jwt)) {
        return jwt;
      }
      throw new ForbiddenException('Sin acceso a este negocio');
    }

    return home;
  }

  async listAccessibleTenants(
    userId: string,
  ): Promise<Array<{ id: string; nombre: string; cuit: string | null }>> {
    const usuario = await this.findUsuarioById(userId);
    if (!usuario?.esSuperAdmin) {
      throw new ForbiddenException('Sin permisos');
    }

    const accesos = await this.accesoRepo.find({ where: { usuarioId: userId } });
    const ids = [...new Set(accesos.map((a) => a.tenantId))];
    if (ids.length === 0) {
      return [];
    }

    const tenants = await this.tenantRepo.find({
      where: { id: In(ids) },
      order: { nombre: 'ASC' },
      select: ['id', 'nombre', 'cuit'],
    });

    return tenants.map((t) => ({
      id: t.id,
      nombre: t.nombre,
      cuit: t.cuit ?? null,
    }));
  }

  async switchTenantContext(
    userId: string,
    tenantId: string | null,
  ): Promise<{ ok: true }> {
    const usuario = await this.usuarioRepo.findOne({
      where: { id: userId, activo: true },
    });
    if (!usuario) {
      throw new NotFoundException('Usuario no encontrado');
    }
    if (!usuario.esSuperAdmin) {
      throw new ForbiddenException('Sin permisos');
    }

    const home = usuario.tenantId;
    let target = tenantId;

    if (target !== null && target !== home) {
      if (!(await this.hasAcceso(userId, target))) {
        throw new ForbiddenException('Sin acceso a este negocio');
      }
    }

    if (target !== null && target === home) {
      target = null;
    }

    const prev = usuario.tenantContextoId;
    if (prev === target) {
      return { ok: true };
    }

    usuario.tenantContextoId = target;
    await this.usuarioRepo.save(usuario);

    await this.logRepo.save(
      this.logRepo.create({
        usuarioId: userId,
        tenantIdPrev: prev,
        tenantIdNext: target,
      }),
    );

    return { ok: true };
  }
}
