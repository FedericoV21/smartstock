import {
  ForbiddenException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Tenant } from '../config/entities/tenant.entity';
import { UsuarioCredencialLocal } from '../rbac/entities/usuario-credencial-local.entity';
import { Usuario } from '../users/entities/usuario.entity';
import { RolUsuario } from '../users/enums/rol-usuario.enum';
import { AuthSessionService } from './auth-session.service';
import { hashPin } from './utils/local-credentials.util';
import { LocalAuthService } from './local-auth.service';

describe('LocalAuthService', () => {
  let service: LocalAuthService;
  let credencialRepo: {
    createQueryBuilder: jest.Mock;
    update: jest.Mock;
  };
  let usuarioRepo: { findOne: jest.Mock };
  let tenantRepo: { createQueryBuilder: jest.Mock };
  let jwtService: { sign: jest.Mock };
  let authSessionService: { issueSession: jest.Mock };

  const tenantId = '00000000-0000-4000-8000-000000000001';
  const userId = '44444444-4444-4444-8444-444444444444';
  let pinHash = '';

  beforeAll(async () => {
    pinHash = await hashPin('123456');
  });

  beforeEach(async () => {
    const credQb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({
        usuarioId: userId,
        tenantId,
        usernameLocal: 'cajero',
        pinHash,
        activo: true,
        pinTemporal: true,
        intentosFallidos: 0,
        bloqueadoHasta: null,
      }),
    };

    credencialRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(credQb),
      update: jest.fn().mockResolvedValue(undefined),
    };

    usuarioRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: userId,
        tenantId,
        email: 'labc@example.invalid',
        nombre: 'Cajero',
        apellido: 'Local',
        rol: RolUsuario.operador,
        activo: true,
        esSuperAdmin: false,
        sucursalDefaultId: null,
        deletedAt: null,
      }),
    };

    const tenantQb = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({ id: tenantId }),
    };

    tenantRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(tenantQb),
    };

    jwtService = {
      sign: jest.fn().mockReturnValue('signed-jwt-token'),
    };

    authSessionService = {
      issueSession: jest.fn().mockReturnValue({
        access_token: 'signed-jwt-token',
        refresh_token: 'refresh-token',
        token_type: 'Bearer',
        expires_in: 3600,
        pin_temporal: true,
        user: {
          id: userId,
          tenant_id: tenantId,
          rol: RolUsuario.operador,
          username_local: 'cajero',
        },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocalAuthService,
        { provide: getRepositoryToken(Tenant), useValue: tenantRepo },
        { provide: getRepositoryToken(UsuarioCredencialLocal), useValue: credencialRepo },
        { provide: getRepositoryToken(Usuario), useValue: usuarioRepo },
        { provide: AuthSessionService, useValue: authSessionService },
      ],
    }).compile();

    service = module.get(LocalAuthService);
  });

  it('emite JWT con credenciales válidas', async () => {
    const result = await service.login({
      tenantId,
      username: 'cajero',
      pin: '123456',
    });

    expect(result.access_token).toBe('signed-jwt-token');
    expect(authSessionService.issueSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: userId }),
      expect.objectContaining({ username_local: 'cajero' }),
    );
    expect(credencialRepo.update).toHaveBeenCalledWith(
      { usuarioId: userId },
      expect.objectContaining({ intentosFallidos: 0 }),
    );
  });

  it('resuelve tenant por código de acceso', async () => {
    await service.login({
      tenantCode: 'demo',
      username: 'cajero',
      pin: '123456',
    });

    expect(tenantRepo.createQueryBuilder).toHaveBeenCalled();
  });

  it('rechaza PIN incorrecto e incrementa intentos', async () => {
    await expect(
      service.login({ tenantId, username: 'cajero', pin: '000000' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(credencialRepo.update).toHaveBeenCalledWith(
      { usuarioId: userId },
      expect.objectContaining({ intentosFallidos: 1 }),
    );
  });

  it('bloquea tras demasiados intentos fallidos', async () => {
    credencialRepo.createQueryBuilder().getOne.mockResolvedValue({
      usuarioId: userId,
      tenantId,
      usernameLocal: 'cajero',
      pinHash,
      activo: true,
      pinTemporal: true,
      intentosFallidos: 4,
      bloqueadoHasta: null,
    });

    await expect(
      service.login({ tenantId, username: 'cajero', pin: '000000' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(credencialRepo.update).toHaveBeenCalledWith(
      { usuarioId: userId },
      expect.objectContaining({
        intentosFallidos: 0,
        bloqueadoHasta: expect.any(Date),
      }),
    );
  });

  it('rechaza usuario bloqueado', async () => {
    credencialRepo.createQueryBuilder().getOne.mockResolvedValue({
      usuarioId: userId,
      tenantId,
      usernameLocal: 'cajero',
      pinHash,
      activo: true,
      pinTemporal: true,
      intentosFallidos: 0,
      bloqueadoHasta: new Date(Date.now() + 60_000),
    });

    await expect(
      service.login({ tenantId, username: 'cajero', pin: '123456' }),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('rechaza usuario inactivo', async () => {
    usuarioRepo.findOne.mockResolvedValue({
      id: userId,
      tenantId,
      activo: false,
      deletedAt: null,
    });

    await expect(
      service.login({ tenantId, username: 'cajero', pin: '123456' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
