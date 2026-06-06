import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Sucursal } from '../branches/entities/sucursal.entity';
import { RolUsuario } from './enums/rol-usuario.enum';
import { UsuarioSucursal } from './entities/usuario-sucursal.entity';
import { Usuario } from './entities/usuario.entity';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let usuarioRepo: jest.Mocked<
    Pick<Repository<Usuario>, 'findOne' | 'save' | 'create' | 'exist'>
  >;
  let usuarioSucursalRepo: jest.Mocked<
    Pick<Repository<UsuarioSucursal>, 'exist' | 'save' | 'create' | 'find'>
  >;
  let sucursalRepo: jest.Mocked<Pick<Repository<Sucursal>, 'find' | 'findOne' | 'exist' | 'count'>>;

  const tenantId = '00000000-0000-4000-8000-000000000001';
  const userId = '33333333-3333-4333-8333-333333333333';
  const sucursalId = 'd0000001-0001-4001-8001-000000000001';

  beforeEach(async () => {
    usuarioRepo = {
      findOne: jest.fn(),
      save: jest.fn(async (u) => u as Usuario),
      create: jest.fn((payload) => payload as Usuario),
      exist: jest.fn(),
    } as unknown as typeof usuarioRepo;

    usuarioSucursalRepo = {
      exist: jest.fn(),
      save: jest.fn(),
      create: jest.fn((payload) => payload as UsuarioSucursal),
      find: jest.fn().mockResolvedValue([]),
    } as unknown as typeof usuarioSucursalRepo;

    sucursalRepo = {
      find: jest.fn().mockResolvedValue([{ id: sucursalId }]),
      findOne: jest.fn().mockResolvedValue({ id: sucursalId, tenantId, activa: true }),
      exist: jest.fn().mockResolvedValue(true),
      count: jest.fn().mockResolvedValue(1),
    } as unknown as typeof sucursalRepo;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(Usuario), useValue: usuarioRepo },
        { provide: getRepositoryToken(UsuarioSucursal), useValue: usuarioSucursalRepo },
        { provide: getRepositoryToken(Sucursal), useValue: sucursalRepo },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  it('creates usuario profile on first JWT sync', async () => {
    usuarioRepo.findOne.mockResolvedValueOnce(null);
    const created = await service.ensureFromJwt(
      { sub: userId, email: 'demo@test.com', rol: 'admin' },
      tenantId,
    );
    expect(created.id).toBe(userId);
    expect(usuarioRepo.save).toHaveBeenCalled();
    expect(usuarioSucursalRepo.save).toHaveBeenCalled();
  });

  it('persists sucursal default for admin', async () => {
    usuarioRepo.findOne.mockResolvedValue({
      id: userId,
      tenantId,
      nombre: 'Admin',
      apellido: '',
      email: 'demo@test.com',
      rol: RolUsuario.admin,
      activo: true,
      esSuperAdmin: false,
      sucursalDefaultId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const saved = await service.setSucursalDefault(userId, tenantId, sucursalId, 'admin');
    expect(saved.sucursalDefaultId).toBe(sucursalId);
  });

  it('blocks operador without branch assignment', async () => {
    usuarioSucursalRepo.exist.mockResolvedValue(false);
    usuarioRepo.findOne.mockResolvedValue({
      id: userId,
      tenantId,
      nombre: 'Op',
      apellido: '',
      email: 'op@test.com',
      rol: RolUsuario.operador,
      activo: true,
      esSuperAdmin: false,
      sucursalDefaultId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    usuarioSucursalRepo.find.mockResolvedValue([]);
    sucursalRepo.count.mockResolvedValue(2);

    await expect(
      service.setSucursalDefault(userId, tenantId, sucursalId, 'operador'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
