import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { resolveAppRole } from '../auth/utils/resolve-app-role';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { RolUsuario } from './enums/rol-usuario.enum';
import { UsuarioSucursal } from './entities/usuario-sucursal.entity';
import { Usuario } from './entities/usuario.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(Usuario)
    private readonly usuarioRepo: Repository<Usuario>,
    @InjectRepository(UsuarioSucursal)
    private readonly usuarioSucursalRepo: Repository<UsuarioSucursal>,
    @InjectRepository(Sucursal)
    private readonly sucursalRepo: Repository<Sucursal>,
  ) {}

  async ensureFromJwt(user: AccessTokenPayload, tenantId: string): Promise<Usuario> {
    const id = user.sub;
    let row = await this.usuarioRepo.findOne({ where: { id, tenantId, activo: true } });
    if (row) {
      return row;
    }

    const rol = this.mapJwtRole(user);
    const email =
      typeof user.email === 'string' && user.email.trim()
        ? user.email.trim()
        : `${id}@smartstock.local`;
    const nombre = email.includes('@') ? email.split('@')[0] : 'Usuario';

    row = await this.usuarioRepo.save(
      this.usuarioRepo.create({
        id,
        tenantId,
        nombre,
        apellido: '',
        email,
        rol,
        activo: true,
        esSuperAdmin: false,
        sucursalDefaultId: null,
      }),
    );

    const principal = await this.sucursalRepo.find({
      where: { tenantId, activa: true },
      order: { esPrincipal: 'DESC', createdAt: 'ASC' },
      take: 1,
    });
    if (principal[0]) {
      await this.assignSucursalIfMissing(row.id, principal[0].id);
      if (!row.sucursalDefaultId) {
        row.sucursalDefaultId = principal[0].id;
        row = await this.usuarioRepo.save(row);
      }
    }

    return row;
  }

  async getProfile(userId: string, tenantId: string): Promise<Usuario | null> {
    return this.usuarioRepo.findOne({ where: { id: userId, tenantId, activo: true } });
  }

  async getSucursalDefaultId(userId: string, tenantId: string): Promise<string | null> {
    const row = await this.getProfile(userId, tenantId);
    return row?.sucursalDefaultId ?? null;
  }

  async setSucursalDefault(
    userId: string,
    tenantId: string,
    sucursalId: string,
    appRole: string | undefined,
  ): Promise<Usuario> {
    await this.assertCanOperateSucursal(userId, tenantId, sucursalId, appRole);

    const row = await this.usuarioRepo.findOne({ where: { id: userId, tenantId, activo: true } });
    if (!row) {
      throw new NotFoundException('Usuario no encontrado en el negocio.');
    }

    row.sucursalDefaultId = sucursalId;
    await this.assignSucursalIfMissing(userId, sucursalId);
    return this.usuarioRepo.save(row);
  }

  async assertCanOperateSucursal(
    userId: string,
    tenantId: string,
    sucursalId: string,
    appRole: string | undefined,
  ): Promise<void> {
    const sucursal = await this.sucursalRepo.findOne({
      where: { id: sucursalId, tenantId, activa: true },
    });
    if (!sucursal) {
      throw new NotFoundException('Sucursal no encontrada o inactiva.');
    }

    if (appRole === 'admin') {
      return;
    }

    const assigned = await this.usuarioSucursalRepo.exist({
      where: { usuarioId: userId, sucursalId },
    });
    if (assigned) {
      return;
    }

    const profile = await this.getProfile(userId, tenantId);
    if (profile?.sucursalDefaultId === sucursalId) {
      return;
    }

    const operable = await this.listOperableSucursalIds(userId, tenantId, appRole);
    if (operable.length === 1 && operable[0] === sucursalId) {
      return;
    }

    throw new ForbiddenException('No ten├®s permisos para operar en esa sucursal.');
  }

  async listOperableSucursalIds(
    userId: string,
    tenantId: string,
    appRole: string | undefined,
  ): Promise<string[]> {
    if (appRole === 'admin') {
      const rows = await this.sucursalRepo.find({
        where: { tenantId, activa: true },
        select: ['id'],
      });
      return rows.map((r) => r.id);
    }

    const links = await this.usuarioSucursalRepo.find({
      where: { usuarioId: userId },
      select: ['sucursalId'],
    });
    const ids = new Set<string>();
    for (const link of links) {
      const ok = await this.sucursalRepo.exist({
        where: { id: link.sucursalId, tenantId, activa: true },
      });
      if (ok) ids.add(link.sucursalId);
    }

    const profile = await this.getProfile(userId, tenantId);
    if (profile?.sucursalDefaultId) {
      const ok = await this.sucursalRepo.exist({
        where: { id: profile.sucursalDefaultId, tenantId, activa: true },
      });
      if (ok) ids.add(profile.sucursalDefaultId);
    }

    if (ids.size === 0) {
      const count = await this.sucursalRepo.count({ where: { tenantId, activa: true } });
      if (count === 1) {
        const solo = await this.sucursalRepo.findOne({
          where: { tenantId, activa: true },
          select: ['id'],
        });
        if (solo) ids.add(solo.id);
      }
    }

    return [...ids];
  }

  serializeUsuario(u: Usuario) {
    return {
      id: u.id,
      tenantId: u.tenantId,
      nombre: u.nombre,
      apellido: u.apellido,
      email: u.email,
      rol: u.rol,
      activo: u.activo,
      esSuperAdmin: u.esSuperAdmin,
      sucursalDefaultId: u.sucursalDefaultId,
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString(),
    };
  }

  private async assignSucursalIfMissing(usuarioId: string, sucursalId: string) {
    const exists = await this.usuarioSucursalRepo.exist({
      where: { usuarioId, sucursalId },
    });
    if (!exists) {
      await this.usuarioSucursalRepo.save(
        this.usuarioSucursalRepo.create({ usuarioId, sucursalId }),
      );
    }
  }

  private mapJwtRole(user: AccessTokenPayload): RolUsuario {
    const raw = resolveAppRole(user);
    if (raw === 'admin' || raw === 'operador' || raw === 'visor') {
      return raw as RolUsuario;
    }
    return RolUsuario.operador;
  }
}
