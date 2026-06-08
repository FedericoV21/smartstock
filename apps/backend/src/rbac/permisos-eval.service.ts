import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { resolveAppRole } from '../auth/utils/resolve-app-role';
import { Usuario } from '../users/entities/usuario.entity';
import { Permiso } from './entities/permiso.entity';
import { RolPermiso } from './entities/rol-permiso.entity';
import { UsuarioPermiso } from './entities/usuario-permiso.entity';
import { UsuarioRol } from './entities/usuario-rol.entity';

@Injectable()
export class PermisosEvalService {
  constructor(
    @InjectRepository(Usuario) private readonly usuarioRepo: Repository<Usuario>,
    @InjectRepository(Permiso) private readonly permisoRepo: Repository<Permiso>,
    @InjectRepository(RolPermiso) private readonly rolPermisoRepo: Repository<RolPermiso>,
    @InjectRepository(UsuarioPermiso) private readonly usuarioPermisoRepo: Repository<UsuarioPermiso>,
    @InjectRepository(UsuarioRol) private readonly usuarioRolRepo: Repository<UsuarioRol>,
  ) {}

  async hasPermiso(
    user: AccessTokenPayload,
    tenantId: string,
    clave: string,
  ): Promise<boolean> {
    if (!clave?.trim()) return false;

    const userId = user.sub;
    if (!userId) return false;

    if (user.es_super_admin === true || user.isSuperAdmin === true) return true;

    const usuario = await this.usuarioRepo.findOne({
      where: { id: userId, tenantId, activo: true },
      select: ['id', 'rol', 'esSuperAdmin'],
    });
    if (!usuario) return false;
    if (usuario.esSuperAdmin) return true;

    const appRole = resolveAppRole(user) ?? usuario.rol;
    if (appRole === 'admin') return true;

    const permiso = await this.permisoRepo.findOne({ where: { clave } });
    if (!permiso) return false;

    const viaRol = await this.usuarioRolRepo
      .createQueryBuilder('ur')
      .innerJoin('rol', 'r', 'r.id = ur.rol_id AND r.activo = true AND r.tenant_id = :tenantId', {
        tenantId,
      })
      .innerJoin('rol_permiso', 'rp', 'rp.rol_id = ur.rol_id AND rp.permiso_id = :permisoId', {
        permisoId: permiso.id,
      })
      .where('ur.usuario_id = :userId', { userId })
      .getExists();
    if (viaRol) return true;

    const viaDirecto = await this.usuarioPermisoRepo.exist({
      where: { usuarioId: userId, permisoId: permiso.id },
    });
    return viaDirecto;
  }
}
