import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { ComprobantePdfRegenerationService } from '../facturacion/pdf/comprobante-pdf-regeneration.service';
import { ArcaConfig } from './entities/arca-config.entity';
import { ArcaLog } from './entities/arca-log.entity';
import { ArcaAmbiente } from './enums/arca-ambiente.enum';
import { ArcaJobWorkerService } from './arca-job-worker.service';
import { ArcaWsfeService } from './wsfe/arca-wsfe.service';

describe('ArcaJobWorkerService', () => {
  let service: ArcaJobWorkerService;
  let dataSource: { query: jest.Mock };
  let wsfe: { solicitarCaeForTenant: jest.Mock };
  let comprobanteRepo: { findOne: jest.Mock; save: jest.Mock };
  let arcaConfigRepo: { findOne: jest.Mock };
  let arcaLogRepo: { create: jest.Mock; save: jest.Mock };

  beforeEach(async () => {
    dataSource = { query: jest.fn() };
    wsfe = { solicitarCaeForTenant: jest.fn() };
    comprobanteRepo = { findOne: jest.fn(), save: jest.fn() };
    arcaConfigRepo = { findOne: jest.fn() };
    arcaLogRepo = {
      create: jest.fn((x) => x),
      save: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ArcaJobWorkerService,
        { provide: DataSource, useValue: dataSource },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((k: string, def?: unknown) => {
              if (k === 'ARCA_WORKER_STUB') {
                return false;
              }
              return def;
            }),
          },
        },
        { provide: ArcaWsfeService, useValue: wsfe },
        {
          provide: ComprobantePdfRegenerationService,
          useValue: { persistPostCaePdfToStorage: jest.fn().mockResolvedValue({ sizeBytes: 0, pdfUrl: null }) },
        },
        { provide: getRepositoryToken(Comprobante), useValue: comprobanteRepo },
        { provide: getRepositoryToken(ArcaConfig), useValue: arcaConfigRepo },
        { provide: getRepositoryToken(ArcaLog), useValue: arcaLogRepo },
      ],
    }).compile();

    service = module.get(ArcaJobWorkerService);
  });

  it('resetStaleJobs delega en reset_stale_arca_jobs', async () => {
    dataSource.query.mockResolvedValueOnce([{ n: 3 }]);
    await expect(service.resetStaleJobs(12)).resolves.toBe(3);
    expect(dataSource.query).toHaveBeenCalledWith('SELECT public.reset_stale_arca_jobs($1) AS n', [12]);
  });

  it('claimAndProcess sin jobs devuelve contadores en cero', async () => {
    dataSource.query.mockResolvedValueOnce([{ n: 0 }]).mockResolvedValueOnce([]);
    const res = await service.claimAndProcess(5);
    expect(res).toEqual({
      resetStale: 0,
      claimed: 0,
      completed: 0,
      failed: 0,
      scheduledRetry: 0,
    });
    expect(dataSource.query).toHaveBeenNthCalledWith(1, 'SELECT public.reset_stale_arca_jobs($1) AS n', [15]);
    expect(dataSource.query).toHaveBeenNthCalledWith(2, 'SELECT * FROM public.claim_arca_jobs($1)', [5]);
  });

  it('marca completed cuando WSFE devuelve aprobado', async () => {
    dataSource.query.mockResolvedValueOnce([{ n: 0 }]).mockResolvedValueOnce([
      {
        id: 'job-1',
        tenant_id: 't1',
        comprobante_id: 'c1',
        attempts: 1,
        max_attempts: 5,
      },
    ]);
    wsfe.solicitarCaeForTenant.mockResolvedValue({
      data: { estado: 'aprobado', cae: 'x', caeVencimiento: '2099-01-01', errores: [], observaciones: [] },
    });

    const res = await service.claimAndProcess(10);
    expect(res.completed).toBe(1);
    expect(res.claimed).toBe(1);
    expect(wsfe.solicitarCaeForTenant).toHaveBeenCalledWith('t1', { comprobanteId: 'c1' });
    const updates = dataSource.query.mock.calls.filter((c) => String(c[0]).includes('UPDATE public.arca_job'));
    expect(updates.some((c) => String(c[0]).includes("status = 'completed'"))).toBe(true);
  });

  it('stub homologaci├│n completa job sin llamar WSFE', async () => {
    const configGet = jest.fn((k: string, def?: unknown) => {
      if (k === 'ARCA_WORKER_STUB') {
        return true;
      }
      return def;
    });
    const module = await Test.createTestingModule({
      providers: [
        ArcaJobWorkerService,
        { provide: DataSource, useValue: dataSource },
        { provide: ConfigService, useValue: { get: configGet } },
        { provide: ArcaWsfeService, useValue: wsfe },
        {
          provide: ComprobantePdfRegenerationService,
          useValue: {
            persistPostCaePdfToStorage: jest.fn().mockResolvedValue({ sizeBytes: 4, pdfUrl: null }),
          },
        },
        { provide: getRepositoryToken(Comprobante), useValue: comprobanteRepo },
        { provide: getRepositoryToken(ArcaConfig), useValue: arcaConfigRepo },
        { provide: getRepositoryToken(ArcaLog), useValue: arcaLogRepo },
      ],
    }).compile();
    const stubService = module.get(ArcaJobWorkerService);

    dataSource.query.mockResolvedValueOnce([{ n: 0 }]).mockResolvedValueOnce([
      {
        id: 'job-stub',
        tenant_id: 't1',
        comprobante_id: 'c1',
        attempts: 1,
        max_attempts: 5,
      },
    ]);
    arcaConfigRepo.findOne.mockResolvedValue({ ambiente: ArcaAmbiente.homologacion });
    comprobanteRepo.findOne.mockResolvedValue({
      id: 'c1',
      tenantId: 't1',
      sucursalId: 'branch-1',
      cae: null,
      estado: 'pendiente_arca',
    });
    comprobanteRepo.save.mockImplementation((c) => Promise.resolve(c));

    const res = await stubService.claimAndProcess(3);
    expect(res.completed).toBe(1);
    expect(wsfe.solicitarCaeForTenant).not.toHaveBeenCalled();
    expect(comprobanteRepo.save).toHaveBeenCalled();
    expect(arcaLogRepo.save).toHaveBeenCalled();
  });
});
