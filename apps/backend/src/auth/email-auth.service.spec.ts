import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { UsuarioCredencialPassword } from '../rbac/entities/usuario-credencial-password.entity';
import { Usuario } from '../users/entities/usuario.entity';
import { RolUsuario } from '../users/enums/rol-usuario.enum';
import { AuthSessionService } from './auth-session.service';
import { EmailAuthService } from './email-auth.service';
import { hashPassword } from './utils/local-credentials.util';

describe('EmailAuthService', () => {
  let service: EmailAuthService;
  let credencialRepo: { createQueryBuilder: jest.Mock; update: jest.Mock };
  let passwordHash = '';

  const userId = 'user-1';
  const tenantId = 'tenant-1';

  beforeAll(async () => {
    passwordHash = await hashPassword('secret1');
  });

  beforeEach(async () => {
    credencialRepo = {
      createQueryBuilder: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({
          usuarioId: userId,
          email: 'ana@test.com',
          passwordHash,
          intentosFallidos: 0,
          bloqueadoHasta: null,
        }),
      }),
      update: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailAuthService,
        { provide: getRepositoryToken(UsuarioCredencialPassword), useValue: credencialRepo },
        {
          provide: getRepositoryToken(Usuario),
          useValue: {
            findOne: jest.fn().mockResolvedValue({
              id: userId,
              tenantId,
              email: 'ana@test.com',
              nombre: 'Ana',
              apellido: 'Test',
              rol: RolUsuario.admin,
              activo: true,
              esSuperAdmin: false,
              sucursalDefaultId: null,
              deletedAt: null,
            }),
          },
        },
        {
          provide: AuthSessionService,
          useValue: {
            issueSession: jest.fn().mockReturnValue({
              access_token: 'jwt',
              refresh_token: 'refresh',
            }),
          },
        },
      ],
    }).compile();

    service = module.get(EmailAuthService);
  });

  it('login exitoso con email/password', async () => {
    const result = await service.login({
      email: 'ana@test.com',
      password: 'secret1',
    });

    expect(result.refresh_token).toBe('refresh');
  });

  it('401 con password incorrecta', async () => {
    await expect(
      service.login({ email: 'ana@test.com', password: 'wrong' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
