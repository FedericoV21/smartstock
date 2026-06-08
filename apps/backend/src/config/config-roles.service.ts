import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { Permiso } from '../rbac/entities/permiso.entity';
import { Rol } from '../rbac/entities/rol.entity';
import { RolPermiso } from '../rbac/entities/rol-permiso.entity';
import type { CreateRolDto, PatchRolDto } from './dto/config-roles.dto';

@Injectable()
export class ConfigRolesService {
  constructor(
    @InjectRepository(Rol)
    private readonly rolRepo: Repository<Rol>,
    @InjectRepository(Permiso)
    private readonly permisoRepo: Repository<Permiso>,
    @InjectRepository(RolPermiso)
    private readonly rolPermisoRepo: Repository<RolPermiso>,
    private readonly tenantContext: TenantContext,
  ) {}

  async listRoles() {
    const tenantId = this.tenantContext.getTenantId();

    const [roles, permisos, rolePermisos] = await Promise.all([
      this.rolRepo.find({
        where: { tenantId },
        order: { esBase: 'DESC', nombre: 'ASC' },
      }),
      this.permisoRepo.find({ order: { clave: 'ASC' } }),
      this.rolPermisoRepo
        .createQueryBuilder('rp')
        .innerJoin(Rol, 'r', 'r.id = rp.rol_id')
        .where('r.tenant_id = :tenantId', { tenantId })
        .getMany(),
    ]);

    const rolesVisibles = roles.filter((r) => r.slug !== 'superadmin');
    const permisosById = new Map(permisos.map((p) => [p.id, p]));
    const permMap = new Map<string, string[]>();

    for (const rp of rolePermisos) {
      const perm = permisosById.get(rp.permisoId);
      if (!perm) continue;
      const arr = permMap.get(rp.rolId) ?? [];
      arr.push(perm.clave);
      permMap.set(rp.rolId, arr);
    }

    return {
      permisos: permisos.map((p) => ({
        id: p.id,
        clave: p.clave,
        modulo: p.modulo,
        descripcion: p.descripcion,
      })),
      roles: rolesVisibles.map((r) => ({
        id: r.id,
        slug: r.slug,
        nombre: r.nombre,
        descripcion: r.descripcion,
        es_base: r.esBase,
        activo: r.activo,
        permisos: permMap.get(r.id) ?? [],
      })),
    };
  }

  async createRole(dto: CreateRolDto) {
    const tenantId = this.tenantContext.getTenantId();
    const slug = dto.slug.trim().toLowerCase();
    const nombre = dto.nombre.trim();
    const descripcion = dto.descripcion == null ? null : String(dto.descripcion).trim();
    const permisos = (dto.permisos ?? []).map((p) => p.trim()).filter(Boolean);

    if (!slug || !nombre) {
      throw new BadRequestException('slug y nombre son obligatorios.');
    }

    const created = await this.rolRepo.save(
      this.rolRepo.create({
        tenantId,
        slug,
        nombre,
        descripcion,
        esBase: false,
        activo: true,
      }),
    );

    if (permisos.length > 0) {
      await this.replaceRolePermisos(created.id, permisos);
    }

    return {
      id: created.id,
      slug: created.slug,
      nombre: created.nombre,
      descripcion: created.descripcion,
      es_base: created.esBase,
      activo: created.activo,
    };
  }

  async patchRole(id: string, dto: PatchRolDto) {
    const tenantId = this.tenantContext.getTenantId();
    const rol = await this.rolRepo.findOne({ where: { id, tenantId } });
    if (!rol) {
      throw new NotFoundException('Rol no encontrado.');
    }

    const updates: Partial<Rol> = {};
    if (dto.nombre !== undefined) updates.nombre = dto.nombre.trim();
    if (dto.descripcion !== undefined) {
      updates.descripcion =
        dto.descripcion == null ? null : String(dto.descripcion).trim();
    }
    if (dto.activo !== undefined && !rol.esBase) {
      updates.activo = dto.activo;
    }

    if (Object.keys(updates).length > 0) {
      Object.assign(rol, updates);
      await this.rolRepo.save(rol);
    }

    if (dto.permisos !== undefined) {
      const claves = dto.permisos.map((p) => p.trim()).filter(Boolean);
      await this.replaceRolePermisos(id, claves);
    }

    return { ok: true };
  }

  private async replaceRolePermisos(rolId: string, claves: string[]) {
    await this.rolPermisoRepo.delete({ rolId });

    if (claves.length === 0) return;

    const permRows = await this.permisoRepo.find({ where: { clave: In(claves) } });
    if (permRows.length === 0) return;

    await this.rolPermisoRepo.save(
      permRows.map((p) =>
        this.rolPermisoRepo.create({ rolId, permisoId: p.id }),
      ),
    );
  }
}
