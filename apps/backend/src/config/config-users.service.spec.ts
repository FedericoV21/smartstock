import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { Caja } from '../caja/entities/caja.entity';
import { CajaUsuario } from '../caja/entities/caja-usuario.entity';
import { RolUsuario } from '../users/enums/rol-usuario.enum';
import { Usuario } from '../users/entities/usuario.entity';
import { ConfigUsersService } from './config-users.service';

describe('ConfigUsersService', () => {
  let service: ConfigUsersService;
  let usuarioRepo: jest.Mocked<
    Pick<Repository<Usuario>, 'find' | 'findOne' | 'save' | 'create' | 'createQueryBuilder'>
  >;

  const tenantId = '00000000-0000-4000-8000-000000000001';
  const adminId = '33333333-3333-4333-8333-333333333333';
  const targetId = '44444444-4444-4444-8444-444444444444';

  beforeEach(async () => {
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    };

    usuarioRepo = {
      find: jest.fn().mockResolvedValue([
        {
          id: targetId,
          tenantId,
          email: 'op@test.com',
          nombre: 'Op',
          apellido: 'User',
          rol: RolUsuario.operador,
          activo: true,
          createdAt: new Date('2026-01-01'),
        },
      ]),
      findOne: jest.fn(),
      save: jest.fn(async (row) => row as Usuario),
      create: jest.fn((payload) => payload as Usuario),
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    } as unknown as typeof usuarioRepo;

    const cajaQb = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConfigUsersService,
        { provide: getRepositoryToken(Usuario), useValue: usuarioRepo },
        {
          provide: getRepositoryToken(Caja),
          useValue: { createQueryBuilder: jest.fn().mockReturnValue(cajaQb) },
        },
        {
          provide: getRepositoryToken(CajaUsuario),
          useValue: { createQueryBuilder: jest.fn().mockReturnValue(cajaQb) },
        },
        { provide: TenantContext, useValue: { getTenantId: () => tenantId } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('') } },
      ],
    }).compile();

    service = module.get(ConfigUsersService);
  });

  it('lists active users with caja flags', async () => {
    const result = await service.listUsers();
    expect(result.usuarios).toHaveLength(1);
    expect(result.usuarios[0].tiene_caja_enlazada).toBe(false);
    expect(result.usuarios[0].es_local).toBe(false);
  });

  it('blocks self deactivation', async () => {
    usuarioRepo.findOne.mockResolvedValue({
      id: adminId,
      tenantId,
      rol: RolUsuario.admin,
      activo: true,
    } as Usuario);

    await expect(
      service.patchUser(adminId, adminId, { activo: false }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('soft deletes non-admin user', async () => {
    usuarioRepo.findOne.mockResolvedValue({
      id: targetId,
      tenantId,
      rol: RolUsuario.operador,
      activo: true,
      deletedAt: null,
    } as Usuario);

    const result = await service.deleteUser(targetId, adminId);
    expect(result.success).toBe(true);
    expect(usuarioRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ activo: false, deletedBy: adminId }),
    );
  });

  it('404 when deleting unknown user', async () => {
    usuarioRepo.findOne.mockResolvedValue(null);
    await expect(service.deleteUser(targetId, adminId)).rejects.toBeInstanceOf(NotFoundException);
  });
});
