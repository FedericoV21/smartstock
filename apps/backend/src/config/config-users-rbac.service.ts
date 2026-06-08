import { randomUUID } from 'crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';

import {
  buildLocalAuthEmail,
  hashPin,
  isValidPin,
  normalizeLocalUsername,
} from '../auth/utils/local-credentials.util';
import { TenantContext } from '../auth/tenant-context.service';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { PedidoWorkflowEstado } from '../pedidos/entities/pedido-workflow-estado.entity';
import { Permiso } from '../rbac/entities/permiso.entity';
import { Rol } from '../rbac/entities/rol.entity';
import { UsuarioCredencialLocal } from '../rbac/entities/usuario-credencial-local.entity';
import { UsuarioPedidoWorkflowEstado } from '../rbac/entities/usuario-pedido-workflow-estado.entity';
import { UsuarioPermiso } from '../rbac/entities/usuario-permiso.entity';
import { UsuarioRol } from '../rbac/entities/usuario-rol.entity';
import { Usuario } from '../users/entities/usuario.entity';
import { UsuarioSucursal } from '../users/entities/usuario-sucursal.entity';
import { RolUsuario } from '../users/enums/rol-usuario.enum';
import { PERMISOS_ASIGNABLES_USUARIO } from './constants/permisos-asignables-usuario';
import type {
  ChangeUserPinDto,
  CreateLocalUserDto,
  PatchUserPermisosExtraDto,
  PutUserPedidosWorkflowEstadosDto,
  PutUserSucursalesDto,
} from './dto/config-users-rbac.dto';

const ALLOW_PERMISOS = new Set<string>(PERMISOS_ASIGNABLES_USUARIO);

@Injectable()
export class ConfigUsersRbacService {
  constructor(
    @InjectRepository(Usuario)
    private readonly usuarioRepo: Repository<Usuario>,
    @InjectRepository(UsuarioSucursal)
    private readonly usuarioSucursalRepo: Repository<UsuarioSucursal>,
    @InjectRepository(Sucursal)
    private readonly sucursalRepo: Repository<Sucursal>,
    @InjectRepository(Rol)
    private readonly rolRepo: Repository<Rol>,
    @InjectRepository(UsuarioRol)
    private readonly usuarioRolRepo: Repository<UsuarioRol>,
    @InjectRepository(Permiso)
    private readonly permisoRepo: Repository<Permiso>,
    @InjectRepository(UsuarioPermiso)
    private readonly usuarioPermisoRepo: Repository<UsuarioPermiso>,
    @InjectRepository(UsuarioCredencialLocal)
    private readonly credencialRepo: Repository<UsuarioCredencialLocal>,
    @InjectRepository(UsuarioPedidoWorkflowEstado)
    private readonly workflowEstadoRepo: Repository<UsuarioPedidoWorkflowEstado>,
    @InjectRepository(PedidoWorkflowEstado)
    private readonly pedidoEstadoRepo: Repository<PedidoWorkflowEstado>,
    private readonly tenantContext: TenantContext,
    private readonly dataSource: DataSource,
  ) {}

  async getUserSucursales(userId: string) {
    await this.assertUserInTenant(userId);

    const rows = await this.usuarioSucursalRepo.find({ where: { usuarioId: userId } });
    return { sucursalIds: rows.map((r) => r.sucursalId) };
  }

  async putUserSucursales(userId: string, dto: PutUserSucursalesDto) {
    const tenantId = this.tenantContext.getTenantId();
    await this.assertUserInTenant(userId);

    const sucursalIds = dto.sucursalIds.filter(Boolean);
    if (sucursalIds.length === 0) {
      throw new BadRequestException('Debés asignar al menos una sucursal.');
    }

    const sucursales = await this.sucursalRepo.find({
      where: { tenantId, id: In(sucursalIds) },
    });
    const validIds = sucursales.map((s) => s.id);
    if (validIds.length !== sucursalIds.length) {
      throw new BadRequestException('Una o más sucursales no pertenecen al negocio.');
    }

    const resolvedDefaultId =
      dto.defaultSucursalId && validIds.includes(dto.defaultSucursalId)
        ? dto.defaultSucursalId
        : validIds[0];

    await this.dataSource.transaction(async (manager) => {
      await manager.delete(UsuarioSucursal, { usuarioId: userId });
      await manager.save(
        UsuarioSucursal,
        validIds.map((sucursalId) => ({ usuarioId: userId, sucursalId })),
      );
      await manager.update(Usuario, { id: userId, tenantId }, { sucursalDefaultId: resolvedDefaultId });
    });

    return {
      success: true,
      sucursalIds: validIds,
      defaultSucursalId: resolvedDefaultId,
    };
  }

  async changeUserPin(userId: string, dto: ChangeUserPinDto) {
    const tenantId = this.tenantContext.getTenantId();
    await this.assertUserInTenant(userId);

    if (!isValidPin(dto.pin)) {
      throw new BadRequestException('El PIN debe tener entre 4 y 8 dígitos.');
    }

    const cred = await this.credencialRepo.findOne({ where: { usuarioId: userId } });
    if (!cred) {
      throw new BadRequestException('Este usuario no tiene credencial local para PIN.');
    }

    const pinHash = await hashPin(dto.pin);
    const pinTemporal = dto.pinTemporal ?? true;

    await this.credencialRepo.save({
      ...cred,
      tenantId,
      pinHash,
      pinTemporal,
      activo: true,
      intentosFallidos: 0,
      bloqueadoHasta: null,
    });

    return { success: true };
  }

  async getUserPermisosExtra(userId: string) {
    const target = await this.assertUserInTenant(userId);

    const permRows = await this.permisoRepo.find({
      where: { clave: In([...PERMISOS_ASIGNABLES_USUARIO]) },
    });
    const allowIds = permRows.map((p) => p.id);
    const idToClave = new Map(permRows.map((p) => [p.id, p.clave]));

    if (allowIds.length === 0) {
      return { permisos_clave: [] as string[], target_rol: target.rol };
    }

    const upRows = await this.usuarioPermisoRepo.find({
      where: { usuarioId: userId, permisoId: In(allowIds) },
    });

    const claves = [
      ...new Set(upRows.map((r) => idToClave.get(r.permisoId)).filter(Boolean)),
    ] as string[];

    return { permisos_clave: claves, target_rol: target.rol };
  }

  async patchUserPermisosExtra(userId: string, dto: PatchUserPermisosExtraDto) {
    const target = await this.assertUserInTenant(userId);

    if (target.rol === RolUsuario.admin) {
      throw new BadRequestException(
        'Los administradores tienen todos los permisos; no aplica asignación manual.',
      );
    }

    const clavesPedidas = [
      ...new Set(dto.permisos.map((x) => x.trim()).filter((c) => ALLOW_PERMISOS.has(c))),
    ];

    const permRows = await this.permisoRepo.find({
      where: { clave: In([...PERMISOS_ASIGNABLES_USUARIO]) },
    });
    const claveToId = new Map(permRows.map((r) => [r.clave, r.id]));
    const allowIds = permRows.map((r) => r.id);

    const permisoIdsInsert = clavesPedidas
      .map((c) => claveToId.get(c))
      .filter((id): id is string => typeof id === 'string');

    if (allowIds.length > 0) {
      await this.usuarioPermisoRepo.delete({
        usuarioId: userId,
        permisoId: In(allowIds),
      });
    }

    if (permisoIdsInsert.length > 0) {
      await this.usuarioPermisoRepo.save(
        permisoIdsInsert.map((permisoId) => ({ usuarioId: userId, permisoId })),
      );
    }

    return { ok: true, permisos_clave: clavesPedidas };
  }

  async getUserPedidosWorkflowEstados(userId: string) {
    const tenantId = this.tenantContext.getTenantId();
    const target = await this.assertUserInTenant(userId);

    const rows = await this.workflowEstadoRepo.find({
      where: { tenantId, usuarioId: userId },
    });

    const ids = [...new Set(rows.map((r) => r.workflowEstadoId).filter(Boolean))];
    return {
      workflow_estado_ids: ids,
      pedidos_puede_crear: Boolean(target.pedidosPuedeCrear),
      target_rol: target.rol,
    };
  }

  async putUserPedidosWorkflowEstados(userId: string, dto: PutUserPedidosWorkflowEstadosDto) {
    const tenantId = this.tenantContext.getTenantId();
    const target = await this.assertUserInTenant(userId);

    if (target.rol === RolUsuario.admin) {
      throw new BadRequestException(
        'Los administradores siempre tienen visibilidad completa en pedidos; no aplica esta asignación.',
      );
    }

    const uniqueIds = [
      ...new Set(dto.workflow_estado_ids.filter((x) => typeof x === 'string' && x.trim() !== '')),
    ];

    if (uniqueIds.length > 0) {
      const valid = await this.pedidoEstadoRepo.find({
        where: { tenantId, id: In(uniqueIds) },
      });
      const ok = new Set(valid.map((r) => r.id));
      for (const id of uniqueIds) {
        if (!ok.has(id)) {
          throw new BadRequestException(
            `Estado de workflow inválido o de otro negocio: ${id}`,
          );
        }
      }
    }

    await this.workflowEstadoRepo.delete({ tenantId, usuarioId: userId });

    if (uniqueIds.length > 0) {
      await this.workflowEstadoRepo.save(
        uniqueIds.map((workflowEstadoId) => ({
          tenantId,
          usuarioId: userId,
          workflowEstadoId,
        })),
      );
    }

    let pedidosPuedeCrearFinal = Boolean(target.pedidosPuedeCrear);
    if (dto.pedidos_puede_crear !== undefined) {
      await this.usuarioRepo.update(
        { id: userId, tenantId },
        { pedidosPuedeCrear: dto.pedidos_puede_crear },
      );
      pedidosPuedeCrearFinal = dto.pedidos_puede_crear;
    }

    return {
      ok: true,
      workflow_estado_ids: uniqueIds,
      pedidos_puede_crear: pedidosPuedeCrearFinal,
    };
  }

  async createLocalUser(dto: CreateLocalUserDto) {
    const tenantId = this.tenantContext.getTenantId();
    const nombre = dto.nombre.trim();
    const apellido = dto.apellido.trim();
    const username = normalizeLocalUsername(dto.username);
    const pin = dto.pin;
    const rol =
      dto.rol === RolUsuario.visor
        ? RolUsuario.visor
        : dto.rol === RolUsuario.admin
          ? RolUsuario.admin
          : RolUsuario.operador;
    const rolId = dto.rolId?.trim() || null;
    const sucursalIds = (dto.sucursalIds ?? []).filter(Boolean);

    if (!nombre || !apellido || !username) {
      throw new BadRequestException('Nombre, apellido y username son obligatorios.');
    }
    if (!isValidPin(pin)) {
      throw new BadRequestException('El PIN debe tener entre 4 y 8 dígitos.');
    }

    const existing = await this.credencialRepo
      .createQueryBuilder('c')
      .where('c.tenant_id = :tenantId', { tenantId })
      .andWhere('LOWER(c.username_local) = :username', { username })
      .getOne();
    if (existing) {
      throw new ConflictException('Ya existe un usuario local con ese nombre de usuario.');
    }

    const localEmail = buildLocalAuthEmail(tenantId, username);
    const pinHash = await hashPin(pin);
    const userId = randomUUID();

    let targetRoleId: string | null = null;
    let rolLegacyForUser = rol;

    const baseRole = await this.rolRepo.findOne({
      where: { tenantId, slug: rol },
    });

    targetRoleId = baseRole?.id ?? null;

    if (rolId) {
      const customRole = await this.rolRepo.findOne({
        where: { id: rolId, tenantId },
      });
      if (!customRole || !customRole.activo) {
        throw new BadRequestException('Rol personalizado inválido o inactivo.');
      }
      targetRoleId = customRole.id;
      if (
        customRole.esBase &&
        (customRole.slug === 'admin' ||
          customRole.slug === 'operador' ||
          customRole.slug === 'visor')
      ) {
        rolLegacyForUser = customRole.slug as RolUsuario;
      } else {
        rolLegacyForUser = RolUsuario.operador;
      }
    }

    let validSucursalIds: string[] = [];
    if (sucursalIds.length > 0) {
      const sucursales = await this.sucursalRepo.find({
        where: { tenantId, id: In(sucursalIds) },
      });
      validSucursalIds = sucursales.map((s) => s.id);
    }
    const defaultSucursalId = validSucursalIds[0] ?? null;

    await this.dataSource.transaction(async (manager) => {
      await manager.save(
        Usuario,
        manager.create(Usuario, {
          id: userId,
          tenantId,
          email: localEmail,
          nombre,
          apellido,
          rol: rolLegacyForUser,
          activo: true,
          esSuperAdmin: false,
          sucursalDefaultId: defaultSucursalId,
          pedidosPuedeCrear: false,
          deletedAt: null,
          deletedBy: null,
        }),
      );

      if (targetRoleId) {
        await manager.save(UsuarioRol, { usuarioId: userId, rolId: targetRoleId });
      }

      await manager.save(
        UsuarioCredencialLocal,
        manager.create(UsuarioCredencialLocal, {
          usuarioId: userId,
          tenantId,
          usernameLocal: username,
          pinHash,
          pinTemporal: true,
          activo: true,
          intentosFallidos: 0,
          bloqueadoHasta: null,
        }),
      );

      if (validSucursalIds.length > 0) {
        await manager.save(
          UsuarioSucursal,
          validSucursalIds.map((sucursalId) => ({ usuarioId: userId, sucursalId })),
        );
      }
    });

    return { success: true, id: userId };
  }

  private async assertUserInTenant(userId: string): Promise<Usuario> {
    const tenantId = this.tenantContext.getTenantId();
    const target = await this.usuarioRepo.findOne({
      where: { id: userId, tenantId, deletedAt: IsNull() },
    });
    if (!target) {
      throw new NotFoundException('Usuario no encontrado.');
    }
    return target;
  }
}
