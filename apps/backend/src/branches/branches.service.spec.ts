import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { Tenant } from '../config/entities/tenant.entity';
import { UsersService } from '../users/users.service';
import { RolUsuario } from '../users/enums/rol-usuario.enum';
import { BranchesService } from './branches.service';
import { Sucursal } from './entities/sucursal.entity';
import { SucursalContext } from './sucursal-context.service';

describe('BranchesService', () => {
  let service: BranchesService;
  let sucursalRepo: jest.Mocked<Pick<Repository<Sucursal>, 'find' | 'findOne' | 'create' | 'save' | 'remove'>>;
  let tenantRepo: jest.Mocked<Pick<Repository<Tenant>, 'findOne'>>;
  let sucursalContext: {
    resolveSucursalId: jest.Mock;
    getJwtDefaultSucursalId: jest.Mock;
    setActiveSucursalId: jest.Mock;
  };

  const tenantId = '00000000-0000-4000-8000-000000000001';
  const principal: Sucursal = {
    id: 'd0000001-0001-4001-8001-000000000001',
    tenantId,
    codigo: 'CASA',
    nombre: 'Sucursal Principal',
    direccion: null,
    activa: true,
    esPrincipal: true,
    heredaDatosTicket: true,
    razonSocial: null,
    cuit: null,
    telefono: null,
    horariosAtencion: null,
    email: null,
    posPrefs: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(async () => {
    sucursalRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((payload) => payload as Sucursal),
      save: jest.fn(async (row) => ({ ...row, id: row.id ?? 'new-id' }) as Sucursal),
      remove: jest.fn(),
    } as unknown as typeof sucursalRepo;

    tenantRepo = {
      findOne: jest.fn(),
    } as unknown as typeof tenantRepo;

    sucursalContext = {
      resolveSucursalId: jest.fn().mockResolvedValue(principal.id),
      getJwtDefaultSucursalId: jest.fn().mockReturnValue(null),
      setActiveSucursalId: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BranchesService,
        { provide: getRepositoryToken(Sucursal), useValue: sucursalRepo },
        { provide: getRepositoryToken(Tenant), useValue: tenantRepo },
        { provide: TenantContext, useValue: { getTenantId: () => tenantId } },
        { provide: SucursalContext, useValue: sucursalContext },
        {
          provide: UsersService,
          useValue: {
            ensureFromJwt: jest.fn().mockResolvedValue({
              id: 'user-1',
              tenantId,
              sucursalDefaultId: principal.id,
              rol: RolUsuario.admin,
            }),
            listOperableSucursalIds: jest.fn().mockResolvedValue([principal.id]),
            setSucursalDefault: jest.fn().mockResolvedValue({
              sucursalDefaultId: principal.id,
            }),
          },
        },
      ],
    }).compile();

    service = module.get(BranchesService);
  });

  it('lists branches for tenant', async () => {
    sucursalRepo.find.mockResolvedValue([principal]);
    const result = await service.list();
    expect(result.data).toHaveLength(1);
    expect(result.data[0].codigo).toBe('CASA');
  });

  it('rejects delete on principal branch', async () => {
    sucursalRepo.findOne.mockResolvedValue(principal);
    await expect(service.remove(principal.id)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('maps unique violation to conflict', async () => {
    sucursalRepo.findOne.mockResolvedValue({ ...principal, esPrincipal: false });
    sucursalRepo.save.mockRejectedValue(
      new QueryFailedError('INSERT', [], { code: '23505' } as never),
    );
    await expect(service.update(principal.id, { codigo: 'OTRO' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('returns active context with resolved branch', async () => {
    sucursalRepo.find.mockResolvedValue([principal]);
    const result = await service.getActiveContext({
      sub: 'user-1',
      tenant_id: tenantId,
      rol: 'admin',
    });
    expect(result.data.resolvedSucursalId).toBe(principal.id);
    expect(result.data.branches).toHaveLength(1);
  });

  it('throws when branch not found', async () => {
    sucursalRepo.findOne.mockResolvedValue(null);
    await expect(service.getById('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
