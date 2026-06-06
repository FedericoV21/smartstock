import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { Caja } from '../caja/entities/caja.entity';
import { CajaUsuario } from '../caja/entities/caja-usuario.entity';
import { RolUsuario } from '../users/enums/rol-usuario.enum';
import { Usuario } from '../users/entities/usuario.entity';
import type { InviteUserDto } from './dto/config-users.dto';
import type { PatchConfigUserDto } from './dto/config-users.dto';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class ConfigUsersService {
  constructor(
    @InjectRepository(Usuario)
    private readonly usuarioRepo: Repository<Usuario>,
    @InjectRepository(Caja)
    private readonly cajaRepo: Repository<Caja>,
    @InjectRepository(CajaUsuario)
    private readonly cajaUsuarioRepo: Repository<CajaUsuario>,
    private readonly tenantContext: TenantContext,
    private readonly config: ConfigService,
  ) {}

  async listUsers() {
    const tenantId = this.tenantContext.getTenantId();
    const rows = await this.usuarioRepo.find({
      where: { tenantId, deletedAt: IsNull() },
      order: { createdAt: 'ASC' },
    });

    const userIds = rows.map((u) => u.id);
    const cajaLinked = await this.loadCajaLinkedUserIds(tenantId, userIds);

    return {
      usuarios: rows.map((u) => ({
        id: u.id,
        email: u.email,
        nombre: u.nombre,
        apellido: u.apellido,
        rol: u.rol,
        activo: u.activo,
        created_at: u.createdAt.toISOString(),
        es_local: false,
        username_local: null,
        tiene_caja_enlazada: cajaLinked.has(u.id),
      })),
    };
  }

  async inviteUser(dto: InviteUserDto) {
    const tenantId = this.tenantContext.getTenantId();
    const email = dto.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      throw new BadRequestException('Correo electr├│nico inv├ílido');
    }
    if (dto.rol !== RolUsuario.operador && dto.rol !== RolUsuario.visor) {
      throw new BadRequestException('Rol inv├ílido (operador o visor)');
    }

    const exists = await this.usuarioRepo
      .createQueryBuilder('u')
      .where('u.tenant_id = :tenantId', { tenantId })
      .andWhere('LOWER(u.email) = :email', { email })
      .andWhere('u.deleted_at IS NULL')
      .getOne();
    if (exists) {
      throw new BadRequestException('Ya existe un usuario con ese correo en tu negocio');
    }

    const supabaseUrl = this.config.get<string>('SUPABASE_URL')?.trim();
    const serviceKey = this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY')?.trim();
    if (!supabaseUrl || !serviceKey) {
      throw new ServiceUnavailableException(
        'Invitaci├│n por correo requiere SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el backend.',
      );
    }

    const base =
      this.config.get<string>('PUBLIC_APP_BASE_URL')?.trim() ||
      this.config.get<string>('NEST_CORS_ORIGINS')?.split(',')[0]?.trim() ||
      'http://localhost:3000';
    const inviteLandingUrl = `${base.replace(/\/$/, '')}/invitacion/completar`;

    const res = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/invite`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, data: {}, redirect_to: inviteLandingUrl }),
    });

    const payload = (await res.json().catch(() => ({}))) as {
      id?: string;
      user?: { id?: string };
      msg?: string;
      message?: string;
      error_description?: string;
    };

    if (!res.ok) {
      const msg = payload.msg ?? payload.message ?? payload.error_description ?? 'No se pudo enviar la invitaci├│n';
      if (msg.toLowerCase().includes('already') || msg.toLowerCase().includes('registered')) {
        throw new BadRequestException('Ese correo ya est├í registrado en el sistema');
      }
      throw new BadRequestException(msg);
    }

    const userId = payload.id ?? payload.user?.id;
    if (!userId) {
      throw new BadRequestException('No se pudo enviar la invitaci├│n');
    }

    try {
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
          deletedAt: null,
          deletedBy: null,
        }),
      );
    } catch (err) {
      await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/admin/users/${userId}`, {
        method: 'DELETE',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
      }).catch(() => undefined);
      throw err;
    }

    return { success: true, id: userId };
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
        throw new BadRequestException('No pod├®s quitarte el rol de administrador');
      }
      updates.rol = dto.rol;
    }
    if (dto.activo !== undefined) {
      if (targetId === actorId && dto.activo === false) {
        throw new BadRequestException('No pod├®s desactivar tu propia cuenta');
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
      throw new BadRequestException('No pod├®s eliminar tu propia cuenta');
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
