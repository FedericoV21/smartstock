import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { Permiso } from '../rbac/entities/permiso.entity';
import { Rol } from '../rbac/entities/rol.entity';
import { UsuarioCredencialPassword } from '../rbac/entities/usuario-credencial-password.entity';
import { AuthRegisterService } from './auth-register.service';

describe('AuthRegisterService', () => {
  let service: AuthRegisterService;
  let credencialRepo: { createQueryBuilder: jest.Mock };
  let transaction: jest.Mock;

  beforeEach(async () => {
    credencialRepo = {
      createQueryBuilder: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      }),
    };

    transaction = jest.fn(async (fn) =>
      fn({
        save: jest.fn(async (_entity, data) => {
          if (Array.isArray(data)) {
            return data.map((row, i) => ({ ...row, id: `role-${i}` }));
          }
          return { ...data, id: data.id ?? 'generated-id' };
        }),
        create: jest.fn((_entity, data) => data),
        find: jest.fn().mockResolvedValue([
          { id: 'p1', clave: 'dashboard.ver' },
          { id: 'p2', clave: 'stock.ver' },
        ] as Permiso[]),
      }),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthRegisterService,
        { provide: getRepositoryToken(UsuarioCredencialPassword), useValue: credencialRepo },
        {
          provide: DataSource,
          useValue: { transaction },
        },
      ],
    }).compile();

    service = module.get(AuthRegisterService);
  });

  it('registra tenant + admin', async () => {
    const result = await service.register({
      negocio: 'Mi Kiosco',
      nombre: 'Ana',
      apellido: 'Test',
      email: 'ana@test.com',
      password: 'secret1',
    });

    expect(result).toEqual({ success: true });
    expect(transaction).toHaveBeenCalled();
  });

  it('409 si el email ya existe', async () => {
    credencialRepo.createQueryBuilder().getOne.mockResolvedValue({ usuarioId: 'u1' });

    await expect(
      service.register({
        negocio: 'X',
        nombre: 'A',
        apellido: 'B',
        email: 'dup@test.com',
        password: 'secret1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
