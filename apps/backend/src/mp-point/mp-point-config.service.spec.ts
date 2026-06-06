import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { SucursalContext } from '../branches/sucursal-context.service';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { LegacyFieldCryptoService } from '../common/crypto/legacy-field-crypto.service';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { MpPointConfig } from './entities/mp-point-config.entity';
import { MpPointConfigService } from './mp-point-config.service';

describe('MpPointConfigService', () => {
  let service: MpPointConfigService;
  let configRepo: jest.Mocked<Pick<Repository<MpPointConfig>, 'findOne' | 'find' | 'save' | 'create' | 'delete'>>;
  let moduloRepo: jest.Mocked<Pick<Repository<ModuloConfig>, 'findOne'>>;
  let fieldCrypto: jest.Mocked<Pick<LegacyFieldCryptoService, 'encrypt' | 'tryDecrypt'>>;

  const tenantId = '00000000-0000-4000-8000-000000000001';
  const sucursalId = 'd0000001-0001-4001-8001-000000000001';

  beforeEach(async () => {
    configRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(async (row) => row as MpPointConfig),
      create: jest.fn((payload) => payload as MpPointConfig),
      delete: jest.fn(),
    } as unknown as typeof configRepo;

    moduloRepo = {
      findOne: jest.fn().mockResolvedValue({ facturadorPos: true }),
    } as unknown as typeof moduloRepo;

    fieldCrypto = {
      encrypt: jest.fn((v) => `enc:${v}`),
      tryDecrypt: jest.fn((v) => (v === 'enc:tok' ? 'APP_USR-tokx' : null)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MpPointConfigService,
        { provide: getRepositoryToken(MpPointConfig), useValue: configRepo },
        { provide: getRepositoryToken(ModuloConfig), useValue: moduloRepo },
        {
          provide: getRepositoryToken(Sucursal),
          useValue: { exist: jest.fn().mockResolvedValue(true) },
        },
        { provide: TenantContext, useValue: { getTenantId: () => tenantId } },
        {
          provide: SucursalContext,
          useValue: { resolveSucursalId: jest.fn().mockResolvedValue(sucursalId) },
        },
        { provide: LegacyFieldCryptoService, useValue: fieldCrypto },
      ],
    }).compile();

    service = module.get(MpPointConfigService);
  });

  it('returns empty public config for admin when no row', async () => {
    configRepo.findOne.mockResolvedValue(null);
    const result = await service.getPublicConfig(sucursalId, true);
    expect(result.habilitado).toBe(true);
    expect(result.access_token_configurado).toBe(false);
  });

  it('masks secrets for non-admin', async () => {
    configRepo.findOne.mockResolvedValue({
      habilitado: true,
      deviceId: 'dev-1',
      accessToken: 'enc:tok',
      webhookSecret: 'whsec',
    } as MpPointConfig);

    const result = await service.getPublicConfig(sucursalId, false);
    expect(result.device_id).toBe('dev-1');
    expect(result.access_token_configurado).toBe(false);
    expect(result.webhook_secret_configurado).toBe(false);
  });

  it('shows preview for admin', async () => {
    configRepo.findOne.mockResolvedValue({
      habilitado: true,
      deviceId: 'dev-1',
      accessToken: 'enc:tok',
      webhookSecret: 'whsec',
    } as MpPointConfig);

    const result = await service.getPublicConfig(sucursalId, true);
    expect(result.access_token_configurado).toBe(true);
    expect(result.access_token_preview).toBe('ÔÇªtokx');
    expect(result.webhook_secret_configurado).toBe(true);
  });

  it('rejects when facturador_pos disabled', async () => {
    moduloRepo.findOne.mockResolvedValue({ facturadorPos: false } as ModuloConfig);
    await expect(service.getPublicConfig(sucursalId, true)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('upserts encrypted access token', async () => {
    configRepo.findOne.mockResolvedValue(null);
    await service.patchConfig({ access_token: 'APP_USR-x', device_id: 'TERM1' }, sucursalId);
    expect(fieldCrypto.encrypt).toHaveBeenCalledWith('APP_USR-x');
    expect(configRepo.save).toHaveBeenCalled();
  });

  it('loadSecretsForSucursal decrypts token', async () => {
    configRepo.findOne.mockResolvedValue({
      accessToken: 'enc:tok',
      deviceId: 'dev',
      webhookSecret: ' wh ',
      habilitado: true,
    } as MpPointConfig);

    const secrets = await service.loadSecretsForSucursal(sucursalId);
    expect(secrets?.accessToken).toBe('APP_USR-tokx');
    expect(secrets?.webhookSecret).toBe('wh');
  });

  it('404 when sucursal invalid on patch', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MpPointConfigService,
        { provide: getRepositoryToken(MpPointConfig), useValue: configRepo },
        { provide: getRepositoryToken(ModuloConfig), useValue: moduloRepo },
        {
          provide: getRepositoryToken(Sucursal),
          useValue: { exist: jest.fn().mockResolvedValue(false) },
        },
        { provide: TenantContext, useValue: { getTenantId: () => tenantId } },
        {
          provide: SucursalContext,
          useValue: { resolveSucursalId: jest.fn().mockResolvedValue(sucursalId) },
        },
        { provide: LegacyFieldCryptoService, useValue: fieldCrypto },
      ],
    }).compile();
    const svc = module.get(MpPointConfigService);
    await expect(svc.patchConfig({ habilitado: false }, sucursalId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
