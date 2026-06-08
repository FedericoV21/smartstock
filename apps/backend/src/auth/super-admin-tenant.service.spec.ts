import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

import { Tenant } from '../config/entities/tenant.entity';
import { Usuario } from '../users/entities/usuario.entity';
import { SuperAdminContextoLog } from './entities/super-admin-contexto-log.entity';
import { SuperAdminTenantAcceso } from './entities/super-admin-tenant-acceso.entity';
import { SuperAdminTenantService } from './super-admin-tenant.service';

describe('SuperAdminTenantService', () => {
  let service: SuperAdminTenantService;
  let usuarioRepo: jest.Mocked<Pick<Repository<Usuario>, 'findOne' | 'save'>>;
  let accesoRepo: jest.Mocked<Pick<Repository<SuperAdminTenantAcceso>, 'exist' | 'find'>>;
  let logRepo: jest.Mocked<Pick<Repository<SuperAdminContextoLog>, 'save' | 'create'>>;
  let tenantRepo: jest.Mocked<Pick<Repository<Tenant>, 'find'>>;

  const home = '11111111-1111-4111-8111-111111111111';
  const client = '22222222-2222-4222-8222-222222222222';
  const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  beforeEach(async () => {
    usuarioRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
    };
    accesoRepo = {
      exist: jest.fn(),
      find: jest.fn(),
    };
    logRepo = {
      save: jest.fn(),
      create: jest.fn((v) => v as SuperAdminContextoLog),
    };
    tenantRepo = {
      find: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SuperAdminTenantService,
        { provide: getRepositoryToken(Usuario), useValue: usuarioRepo },
        { provide: getRepositoryToken(SuperAdminTenantAcceso), useValue: accesoRepo },
        { provide: getRepositoryToken(SuperAdminContextoLog), useValue: logRepo },
        { provide: getRepositoryToken(Tenant), useValue: tenantRepo },
      ],
    }).compile();

    service = module.get(SuperAdminTenantService);
  });

  it('resuelve tenant_contexto_id cuando super-admin impersona', async () => {
    usuarioRepo.findOne.mockResolvedValue({
      id: userId,
      tenantId: home,
      tenantContextoId: client,
      esSuperAdmin: true,
      activo: true,
    } as Usuario);
    accesoRepo.exist.mockResolvedValue(true);

    const effective = await service.resolveEffectiveTenantId({
      userId,
      jwtTenantId: home,
    });

    expect(effective).toBe(client);
  });

  it('header x-tenant-id permite switch inmediato con whitelist', async () => {
    usuarioRepo.findOne.mockResolvedValue({
      id: userId,
      tenantId: home,
      tenantContextoId: null,
      esSuperAdmin: true,
      activo: true,
    } as Usuario);
    accesoRepo.exist.mockResolvedValue(true);

    const effective = await service.resolveEffectiveTenantId({
      userId,
      jwtTenantId: home,
      headerTenantId: client,
    });

    expect(effective).toBe(client);
    expect(accesoRepo.exist).toHaveBeenCalledWith({
      where: { usuarioId: userId, tenantId: client },
    });
  });

  it('rechaza header sin acceso whitelist', async () => {
    usuarioRepo.findOne.mockResolvedValue({
      id: userId,
      tenantId: home,
      esSuperAdmin: true,
      activo: true,
    } as Usuario);
    accesoRepo.exist.mockResolvedValue(false);

    await expect(
      service.resolveEffectiveTenantId({
        userId,
        jwtTenantId: home,
        headerTenantId: client,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('switchTenantContext normaliza tenant casa a null y audita', async () => {
    const usuario = {
      id: userId,
      tenantId: home,
      tenantContextoId: null,
      esSuperAdmin: true,
      activo: true,
    } as Usuario;

    usuarioRepo.findOne.mockResolvedValue({ ...usuario });
    accesoRepo.exist.mockResolvedValue(true);
    usuarioRepo.save.mockImplementation(async (u) => u as Usuario);
    logRepo.save.mockResolvedValue({} as SuperAdminContextoLog);

    const result = await service.switchTenantContext(userId, client);
    expect(result).toEqual({ ok: true });
    expect(usuarioRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ tenantContextoId: client }),
    );
    expect(logRepo.save).toHaveBeenCalled();

    await service.switchTenantContext(userId, home);
    expect(usuarioRepo.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ tenantContextoId: null }),
    );
  });
});
