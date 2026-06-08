import { randomUUID } from 'crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, In, Repository } from 'typeorm';

import { generateOpaqueToken, hashOpaqueToken } from '../auth/utils/opaque-token.util';
import { TenantContext } from '../auth/tenant-context.service';
import { UsuarioInviteToken } from '../auth/entities/usuario-invite-token.entity';
import { Caja } from '../caja/entities/caja.entity';
import { CajaUsuario } from '../caja/entities/caja-usuario.entity';
import { Rol } from '../rbac/entities/rol.entity';
import { UsuarioCredencialLocal } from '../rbac/entities/usuario-credencial-local.entity';
import { UsuarioCredencialPassword } from '../rbac/entities/usuario-credencial-password.entity';
import { UsuarioRol } from '../rbac/entities/usuario-rol.entity';
import { RolUsuario } from '../users/enums/rol-usuario.enum';
import { Usuario } from '../users/entities/usuario.entity';
import { normalizeEmail } from '../auth/utils/local-credentials.util';
import type { InviteUserDto } from './dto/config-users.dto';
import type { PatchConfigUserDto } from './dto/config-users.dto';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_TTL_DAYS = 7;

@Injectable()
export class ConfigUsersService {
  constructor(
    @InjectRepository(Usuario)
    private readonly usuarioRepo: Repository<Usuario>,
    @InjectRepository(Caja)
    private readonly cajaRepo: Repository<Caja>,
    @InjectRepository(CajaUsuario)
    private readonly cajaUsuarioRepo: Repository<CajaUsuario>,
    @InjectRepository(UsuarioCredencialLocal)
    private readonly credencialRepo: Repository<UsuarioCredencialLocal>,
    @InjectRepository(UsuarioCredencialPassword)
    private readonly credencialPasswordRepo: Repository<UsuarioCredencialPassword>,
    @InjectRepository(UsuarioInviteToken)
    private readonly inviteTokenRepo: Repository<UsuarioInviteToken>,
    @InjectRepository(Rol)
    private readonly rolRepo: Repository<Rol>,
    @InjectRepository(UsuarioRol)
    private readonly usuarioRolRepo: Repository<UsuarioRol>,
    private readonly tenantContext: TenantContext,
  ) {}

  async listUsers() {
    const tenantId = this.tenantContext.getTenantId();
    const rows = await this.usuarioRepo.find({
      where: { tenantId, deletedAt: IsNull() },
      order: { createdAt: 'ASC' },
    });

    const userIds = rows.map((u) => u.id);
    const [cajaLinked, credenciales] = await Promise.all([
      this.loadCajaLinkedUserIds(tenantId, userIds),
      userIds.length
        ? this.credencialRepo.find({ where: { usuarioId: In(userIds) } })
        : Promise.resolve([] as UsuarioCredencialLocal[]),
    ]);
    const credByUser = new Map(credenciales.map((c) => [c.usuarioId, c]));

    return {
      usuarios: rows.map((u) => {
        const cred = credByUser.get(u.id);
        return {
          id: u.id,
          email: u.email,
          nombre: u.nombre,
          apellido: u.apellido,
          rol: u.rol,
          activo: u.activo,
          created_at: u.createdAt.toISOString(),
          es_local: Boolean(cred),
          username_local: cred?.usernameLocal ?? null,
          tiene_caja_enlazada: cajaLinked.has(u.id),
        };
      }),
    };
  }

  async inviteUser(dto: InviteUserDto) {
    const tenantId = this.tenantContext.getTenantId();
    const email = normalizeEmail(dto.email);
    if (!EMAIL_RE.test(email)) {
      throw new BadRequestException('Correo electrónico inválido');
    }
    if (dto.rol !== RolUsuario.operador && dto.rol !== RolUsuario.visor) {
      throw new BadRequestException('Rol inválido (operador o visor)');
    }

    const existsInTenant = await this.usuarioRepo
      .createQueryBuilder('u')
      .where('u.tenant_id = :tenantId', { tenantId })
      .andWhere('LOWER(u.email) = :email', { email })
      .andWhere('u.deleted_at IS NULL')
      .getOne();
    if (existsInTenant) {
      throw new BadRequestException('Ya existe un usuario con ese correo en tu negocio');
    }

    const credTaken = await this.credencialPasswordRepo
      .createQueryBuilder('c')
      .where('LOWER(c.email) = :email', { email })
      .getOne();
    if (credTaken) {
      throw new ConflictException('Ese correo ya está registrado en el sistema');
    }

    const otherTenant = await this.usuarioRepo
      .createQueryBuilder('u')
      .where('LOWER(u.email) = :email', { email })
      .andWhere('u.deleted_at IS NULL')
      .getOne();
    if (otherTenant) {
      throw new ConflictException('Ese correo ya está registrado en el sistema');
    }

    const userId = randomUUID();
    const inviteToken = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

    const baseRole = await this.rolRepo.findOne({
      where: { tenantId, slug: dto.rol, esBase: true },
    });

    await this.usuarioRepo.save(
      this.usuarioRepo.create({
        id: userId,
        tenantId,
        email,
        nombre: dto.nombre.trim(),
        apellido: dto.apellido.trim(),
        rol: dto.rol,
        activo: true,
        esSuperAdmin: false,
        sucursalDefaultId: null,
        pedidosPuedeCrear: false,
        deletedAt: null,
        deletedBy: null,
      }),
    );

    await this.inviteTokenRepo.save(
      this.inviteTokenRepo.create({
        usuarioId: userId,
        tenantId,
        tokenHash: hashOpaqueToken(inviteToken),
        expiresAt,
        usedAt: null,
      }),
    );

    if (baseRole) {
      await this.usuarioRolRepo.save({ usuarioId: userId, rolId: baseRole.id });
    }

    return { success: true, id: userId, invite_token: inviteToken };
  }

  async patchUser(targetId: string, actorId: string, dto: PatchConfigUserDto) {
    const tenantId = this.tenantContext.getTenantId();
    const target = await this.usuarioRepo.findOne({
      where: { id: targetId, tenantId, deletedAt: IsNull() },
    });
    if (!target) {
      throw new NotFoundException('Usuario no encontrado');
    }

    const updates: Partial<Usuario> = {};
    if (dto.nombre !== undefined) updates.nombre = dto.nombre.trim();
    if (dto.apellido !== undefined) updates.apellido = dto.apellido.trim();
    if (dto.rol !== undefined) {
      if (targetId === actorId && dto.rol !== RolUsuario.admin) {
        throw new BadRequestException('No podés quitarte el rol de administrador');
      }
      updates.rol = dto.rol;
    }
    if (dto.activo !== undefined) {
      if (targetId === actorId && dto.activo === false) {
        throw new BadRequestException('No podés desactivar tu propia cuenta');
      }
      updates.activo = dto.activo;
    }

    if (Object.keys(updates).length === 0) {
      throw new BadRequestException('Sin cambios');
    }

    Object.assign(target, updates);
    const saved = await this.usuarioRepo.save(target);
    return this.serializeUserRow(saved);
  }

  async deleteUser(targetId: string, actorId: string) {
    if (targetId === actorId) {
      throw new BadRequestException('No podés eliminar tu propia cuenta');
    }

    const tenantId = this.tenantContext.getTenantId();
    const target = await this.usuarioRepo.findOne({ where: { id: targetId, tenantId } });
    if (!target || target.deletedAt) {
      if (target?.deletedAt) return { success: true };
      throw new NotFoundException('Usuario no encontrado');
    }

    if (target.rol === RolUsuario.admin) {
      throw new BadRequestException('No se puede eliminar un administrador');
    }

    target.activo = false;
    target.deletedAt = new Date();
    target.deletedBy = actorId;
    await this.usuarioRepo.save(target);
    return { success: true };
  }

  private serializeUserRow(u: Usuario) {
    return {
      id: u.id,
      tenant_id: u.tenantId,
      email: u.email,
      nombre: u.nombre,
      apellido: u.apellido,
      rol: u.rol,
      activo: u.activo,
      created_at: u.createdAt.toISOString(),
      updated_at: u.updatedAt.toISOString(),
    };
  }

  private async loadCajaLinkedUserIds(tenantId: string, userIds: string[]): Promise<Set<string>> {
    const linked = new Set<string>();
    if (!userIds.length) return linked;

    const [defaults, assignments] = await Promise.all([
      this.cajaRepo
        .createQueryBuilder('c')
        .select('c.usuario_default_id', 'usuarioDefaultId')
        .where('c.tenant_id = :tenantId', { tenantId })
        .andWhere('c.usuario_default_id IN (:...userIds)', { userIds })
        .getRawMany<{ usuarioDefaultId: string }>(),
      this.cajaUsuarioRepo
        .createQueryBuilder('cu')
        .select('cu.usuario_id', 'usuarioId')
        .where('cu.tenant_id = :tenantId', { tenantId })
        .andWhere('cu.usuario_id IN (:...userIds)', { userIds })
        .getRawMany<{ usuarioId: string }>(),
    ]);

    for (const row of defaults) {
      if (row.usuarioDefaultId) linked.add(row.usuarioDefaultId);
    }
    for (const row of assignments) {
      if (row.usuarioId) linked.add(row.usuarioId);
    }
    return linked;
  }
}
