import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { EstadoComprobante } from '../facturacion/enums/estado-comprobante.enum';
import { ArcaHomologationService } from './arca-homologation.service';
import { SucursalContext } from '../branches/sucursal-context.service';
import { ArcaConfig } from './entities/arca-config.entity';
import { ArcaLog } from './entities/arca-log.entity';
import { ArcaAmbiente } from './enums/arca-ambiente.enum';

describe('ArcaHomologationService', () => {
  let service: ArcaHomologationService;
  let module: TestingModule;
  let arcaConfigRepo: jest.Mocked<Pick<Repository<ArcaConfig>, 'findOne'>>;
  let comprobanteRepo: jest.Mocked<Pick<Repository<Comprobante>, 'find'>>;

  beforeEach(async () => {
    arcaConfigRepo = {
      findOne: jest.fn().mockResolvedValue({
        ambiente: ArcaAmbiente.homologacion,
        cuitEmisor: '20123456789',
        puntoDeVenta: 3,
        certificadoPem: 'enc-cert',
        clavePrivadaPem: 'enc-key',
        ticketExpiracion: new Date(Date.now() + 60 * 60 * 1000),
      }),
    };
    comprobanteRepo = {
      find: jest.fn().mockResolvedValue([
        { id: 'comp-pending', numero: 3, tipo: 'factura_a', total: '6050' },
      ]),
    };

    const testingModule: TestingModule = await Test.createTestingModule({
      providers: [
        ArcaHomologationService,
        { provide: getRepositoryToken(ArcaConfig), useValue: arcaConfigRepo },
        { provide: getRepositoryToken(ArcaLog), useValue: { find: jest.fn() } },
        { provide: getRepositoryToken(Comprobante), useValue: comprobanteRepo },
        {
          provide: getRepositoryToken(ModuloConfig),
          useValue: { findOne: jest.fn().mockResolvedValue({ facturadorArca: true }) },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, def?: unknown) => {
              if (key === 'ARCA_ENCRYPTION_KEY') return '12345678901234567890123456789012';
              if (key === 'JWT_SECRET') return 'jwt-secret';
              if (key === 'ARCA_WORKER_SECRET') return 'worker-secret';
              if (key === 'ARCA_WORKER_STUB') return false;
              return def;
            }),
          },
        },
        { provide: TenantContext, useValue: { getTenantId: jest.fn().mockReturnValue('tenant-1') } },
        {
          provide: SucursalContext,
          useValue: { requireSucursalId: jest.fn().mockResolvedValue('branch-1') },
        },
      ],
    }).compile();

    module = testingModule;
    service = module.get(ArcaHomologationService);
  });

  it('readiness ok con config completa', async () => {
    const res = await service.getReadiness();
    expect(res.data.listo_para_homologacion).toBe(true);
    expect(res.data.comprobante_prueba_sugerido).toBe('comp-pending');
  });

  it('readiness falla sin encryption key', async () => {
    const config = service['config'] as ConfigService;
    jest.spyOn(config, 'get').mockImplementation((key: string) => {
      if (key === 'ARCA_ENCRYPTION_KEY') return '';
      if (key === 'JWT_SECRET') return 'jwt';
      return '';
    });
    const res = await service.getReadiness();
    expect(res.data.listo_para_homologacion).toBe(false);
    expect(res.data.bloqueantes).toBeGreaterThan(0);
  });

  it('listLogs trunca XML', async () => {
    const logRepo = module.get(getRepositoryToken(ArcaLog)) as { find: jest.Mock };
    logRepo.find.mockResolvedValue([
      {
        id: 'log-1',
        servicio: 'WSFE',
        operacion: 'FECAESolicitar',
        exitoso: true,
        errorCodigo: null,
        errorMensaje: null,
        comprobanteId: 'comp-1',
        createdAt: new Date('2026-06-05T12:00:00Z'),
        requestXml: `<xml>${'x'.repeat(500)}</xml>`,
        responseXml: null,
      },
    ]);

    const res = await service.listLogs({ limit: 5 });
    expect(res.data.logs[0].request_xml_preview?.endsWith('ÔÇª')).toBe(true);
  });
});
