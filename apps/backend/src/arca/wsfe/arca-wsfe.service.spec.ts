import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TenantContext } from '../../auth/tenant-context.service';
import { Comprobante } from '../../facturacion/entities/comprobante.entity';
import { EstadoComprobante } from '../../facturacion/enums/estado-comprobante.enum';
import { TipoComprobante } from '../../facturacion/enums/tipo-comprobante.enum';
import { ArcaLog } from '../entities/arca-log.entity';
import { ArcaWsaaService } from '../wsaa/arca-wsaa.service';
import { ArcaSolicitarCaeOrchestratorService } from './arca-solicitar-cae-orchestrator.service';
import { ArcaWsfeService } from './arca-wsfe.service';

describe('ArcaWsfeService', () => {
  let service: ArcaWsfeService;
  let comprobanteRepo: jest.Mocked<Pick<Repository<Comprobante>, 'findOne'>>;
  let orchestrator: { solicitarCaeForTenantApi: jest.Mock };

  beforeEach(async () => {
    comprobanteRepo = { findOne: jest.fn() } as unknown as typeof comprobanteRepo;
    orchestrator = { solicitarCaeForTenantApi: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ArcaWsfeService,
        { provide: getRepositoryToken(ArcaLog), useValue: { create: jest.fn(), save: jest.fn() } },
        { provide: getRepositoryToken(Comprobante), useValue: comprobanteRepo },
        { provide: TenantContext, useValue: { getTenantId: jest.fn().mockReturnValue('tenant-1') } },
        { provide: ArcaWsaaService, useValue: { ensureTicketForTenant: jest.fn() } },
        { provide: ArcaSolicitarCaeOrchestratorService, useValue: orchestrator },
      ],
    }).compile();

    service = module.get(ArcaWsfeService);
  });

  it('delegates solicitarCaeForTenant to orchestrator', async () => {
    comprobanteRepo.findOne.mockResolvedValue({
      id: 'comp-1',
      tenantId: 'tenant-1',
      fecha: '2026-04-19',
    } as Comprobante);
    orchestrator.solicitarCaeForTenantApi.mockResolvedValue({
      data: {
        estado: 'aprobado',
        cae: '61234567890123',
        caeVencimiento: '2026-05-01',
        errores: [],
        observaciones: [],
      },
    });

    const res = await service.solicitarCaeForTenant('tenant-1', { comprobanteId: 'comp-1' });
    expect(orchestrator.solicitarCaeForTenantApi).toHaveBeenCalled();
    expect(res.data.estado).toBe('aprobado');
  });

  it('ejecutarFecaeSolicitar returns network on fetch failure', async () => {
    const wsaa = { ensureTicketForTenant: jest.fn().mockResolvedValue({ data: { token: 't', sign: 's' } }) };
    const mod = await Test.createTestingModule({
      providers: [
        ArcaWsfeService,
        { provide: getRepositoryToken(ArcaLog), useValue: { create: jest.fn((v) => v), save: jest.fn() } },
        { provide: getRepositoryToken(Comprobante), useValue: comprobanteRepo },
        { provide: TenantContext, useValue: { getTenantId: jest.fn() } },
        { provide: ArcaWsaaService, useValue: wsaa },
        { provide: ArcaSolicitarCaeOrchestratorService, useValue: orchestrator },
      ],
    }).compile();
    const svc = mod.get(ArcaWsfeService);
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('timeout'));

    const res = await svc.ejecutarFecaeSolicitar({
      tenantId: 't1',
      sucursalId: 'b1',
      comprobanteId: 'c1',
      config: {
        cuitEmisor: '20123456789',
        puntoDeVenta: 1,
        ambiente: 'homologacion',
      } as never,
      comprobante: {
        tipo: TipoComprobante.factura_b,
        subtotal: '100',
        ivaMonto: '0',
        ivaPorcentaje: '0',
        total: '100',
      },
      numero: 5,
      fechaYmd: '2026-04-19',
    });

    expect(res.estado).toBe('pendiente');
    expect(res.errores[0]?.codigo).toBe('NETWORK');
  });
});
