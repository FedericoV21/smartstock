import { randomUUID } from 'crypto';

import {
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { Tenant } from '../config/entities/tenant.entity';
import { PlanTipo } from '../config/enums/plan-tipo.enum';
import { Permiso } from '../rbac/entities/permiso.entity';
import { Rol } from '../rbac/entities/rol.entity';
import { RolPermiso } from '../rbac/entities/rol-permiso.entity';
import { UsuarioCredencialPassword } from '../rbac/entities/usuario-credencial-password.entity';
import { UsuarioRol } from '../rbac/entities/usuario-rol.entity';
import { Usuario } from '../users/entities/usuario.entity';
import { RolUsuario } from '../users/enums/rol-usuario.enum';
import { hashPassword, normalizeEmail } from './utils/local-credentials.util';
import type { RegisterDto } from './dto/register.dto';

const BASE_ROLES = [
  { slug: 'admin', nombre: 'Administrador', descripcion: 'Acceso total al negocio' },
  { slug: 'operador', nombre: 'Operador', descripcion: 'Operación diaria' },
  { slug: 'visor', nombre: 'Visor', descripcion: 'Solo lectura' },
] as const;

const OPERADOR_PERMISOS = [
  'dashboard.ver',
  'ventas.ver',
  'ventas.crear',
  'facturacion.emitir',
  'caja.operar',
  'stock.ver',
  'pedidos.gestionar',
  'reportes.ver',
];

const VISOR_PERMISOS = ['dashboard.ver', 'ventas.ver', 'stock.ver', 'reportes.ver'];

@Injectable()
export class AuthRegisterService {
  constructor(
    @InjectRepository(UsuarioCredencialPassword)
    private readonly credencialRepo: Repository<UsuarioCredencialPassword>,
    private readonly dataSource: DataSource,
  ) {}

  async register(dto: RegisterDto) {
    const negocio = dto.negocio.trim();
    const nombre = dto.nombre.trim();
    const apellido = dto.apellido.trim();
    const email = normalizeEmail(dto.email);
    const password = dto.password;

    const existing = await this.credencialRepo
      .createQueryBuilder('c')
      .where('LOWER(c.email) = :email', { email })
      .getOne();

    if (existing) {
      throw new ConflictException('Ese correo ya está registrado.');
    }

    const userId = randomUUID();
    const tenantId = randomUUID();
    const passwordHash = await hashPassword(password);

    await this.dataSource.transaction(async (manager) => {
      await manager.save(
        Tenant,
        manager.create(Tenant, {
          id: tenantId,
          nombre: negocio,
          activo: true,
          plan: PlanTipo.base,
        }),
      );

      await manager.save(
        ModuloConfig,
        manager.create(ModuloConfig, {
          tenantId,
          stock: true,
          importadorExcel: true,
          facturadorSimple: true,
          facturadorArca: false,
          facturadorPos: false,
          pedidos: true,
          presupuestos: false,
          iaPrecios: true,
          analizadorRentabilidad: false,
        }),
      );

      const roles = await manager.save(
        Rol,
        BASE_ROLES.map((r) =>
          manager.create(Rol, {
            tenantId,
            slug: r.slug,
            nombre: r.nombre,
            descripcion: r.descripcion,
            esBase: true,
            activo: true,
          }),
        ),
      );

      const adminRole = roles.find((r) => r.slug === 'admin');
      const operadorRole = roles.find((r) => r.slug === 'operador');
      const visorRole = roles.find((r) => r.slug === 'visor');

      const permisos = await manager.find(Permiso);
      const permisoByClave = new Map(permisos.map((p) => [p.clave, p.id]));

      if (adminRole) {
        const adminLinks = permisos.map((p) =>
          manager.create(RolPermiso, { rolId: adminRole.id, permisoId: p.id }),
        );
        if (adminLinks.length) await manager.save(RolPermiso, adminLinks);
      }

      if (operadorRole) {
        await this.saveRolePermisos(manager, operadorRole.id, OPERADOR_PERMISOS, permisoByClave);
      }

      if (visorRole) {
        await this.saveRolePermisos(manager, visorRole.id, VISOR_PERMISOS, permisoByClave);
      }

      await manager.save(
        Usuario,
        manager.create(Usuario, {
          id: userId,
          tenantId,
          email,
          nombre,
          apellido,
          rol: RolUsuario.admin,
          activo: true,
          esSuperAdmin: false,
          sucursalDefaultId: null,
          pedidosPuedeCrear: false,
          deletedAt: null,
          deletedBy: null,
        }),
      );

      await manager.save(
        UsuarioCredencialPassword,
        manager.create(UsuarioCredencialPassword, {
          usuarioId: userId,
          email,
          passwordHash,
          intentosFallidos: 0,
          bloqueadoHasta: null,
        }),
      );

      if (adminRole) {
        await manager.save(UsuarioRol, {
          usuarioId: userId,
          rolId: adminRole.id,
        });
      }
    });

    return { success: true };
  }

  private async saveRolePermisos(
    manager: EntityManager,
    rolId: string,
    claves: string[],
    permisoByClave: Map<string, string>,
  ) {
    const links = claves
      .map((clave) => permisoByClave.get(clave))
      .filter((id): id is string => Boolean(id))
      .map((permisoId) => ({ rolId, permisoId }));

    if (links.length) {
      await manager.save(
        RolPermiso,
        links.map((l) => manager.create(RolPermiso, l)),
      );
    }
  }
}
