import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { Permiso } from '../rbac/entities/permiso.entity';
import { Rol } from '../rbac/entities/rol.entity';
import { RolPermiso } from '../rbac/entities/rol-permiso.entity';
import { ConfigRolesService } from './config-roles.service';

describe('ConfigRolesService', () => {
  let service: ConfigRolesService;
  let rolRepo: Pick<Repository<Rol>, 'find' | 'findOne' | 'save' | 'create'>;
  let permisoRepo: Pick<Repository<Permiso>, 'find'>;
  let rolPermisoRepo: Pick<
    Repository<RolPermiso>,
    'createQueryBuilder' | 'delete' | 'save' | 'create'
  >;

  beforeEach(async () => {
    rolRepo = {
      find: jest.fn().mockResolvedValue([
        {
          id: 'r1',
          tenantId: 'tenant-1',
          slug: 'admin',
          nombre: 'Administrador',
          descripcion: null,
          esBase: true,
          activo: true,
        },
      ]),
      findOne: jest.fn(),
      save: jest.fn().mockImplementation(async (entity) => ({ ...entity, id: 'new-role' })),
      create: jest.fn().mockImplementation((data) => data),
    };

    permisoRepo = {
      find: jest.fn().mockResolvedValue([
        { id: 'p1', clave: 'stock.ver', modulo: 'stock', descripcion: 'Ver stock' },
      ]),
    };

    rolPermisoRepo = {
      createQueryBuilder: jest.fn().mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([{ rolId: 'r1', permisoId: 'p1' }]),
      }),
      delete: jest.fn().mockResolvedValue(undefined),
      save: jest.fn().mockResolvedValue(undefined),
      create: jest.fn().mockImplementation((data) => data),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConfigRolesService,
        { provide: getRepositoryToken(Rol), useValue: rolRepo },
        { provide: getRepositoryToken(Permiso), useValue: permisoRepo },
        { provide: getRepositoryToken(RolPermiso), useValue: rolPermisoRepo },
        {
          provide: TenantContext,
          useValue: { getTenantId: () => 'tenant-1' },
        },
      ],
    }).compile();

    service = module.get(ConfigRolesService);
  });

  it('lista roles con permisos', async () => {
    const result = await service.listRoles();
    expect(result.roles).toHaveLength(1);
    expect(result.roles[0].permisos).toEqual(['stock.ver']);
    expect(result.permisos).toHaveLength(1);
  });

  it('crea rol personalizado', async () => {
    const result = await service.createRole({
      slug: 'cajero',
      nombre: 'Cajero',
      permisos: ['stock.ver'],
    });
    expect(result.slug).toBe('cajero');
    expect(rolPermisoRepo.save).toHaveBeenCalled();
  });

  it('falla si falta slug o nombre', async () => {
    await expect(service.createRole({ slug: '', nombre: 'X' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('patch rol inexistente lanza NotFound', async () => {
    rolRepo.findOne = jest.fn().mockResolvedValue(null);
    await expect(service.patchRole('missing', { nombre: 'X' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
