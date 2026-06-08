import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ArcaWsfeService } from '../arca/wsfe/arca-wsfe.service';
import { TenantContext } from '../auth/tenant-context.service';
import { ComprobanteRetryArcaService } from './comprobante-retry-arca.service';
import { ArcaConfig } from '../arca/entities/arca-config.entity';
import { Cliente } from '../catalog/entities/cliente.entity';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { Comprobante } from './entities/comprobante.entity';
import { EstadoComprobante } from './enums/estado-comprobante.enum';
import { TipoComprobante } from './enums/tipo-comprobante.enum';

describe('ComprobanteRetryArcaService', () => {
  let service: ComprobanteRetryArcaService;
  let comprobanteRepo: {
    findOne: jest.Mock;
    update: jest.Mock;
  };
  let moduloRepo: { findOne: jest.Mock };
  let arcaConfigRepo: { findOne: jest.Mock };
  let arcaWsfe: { solicitarCae: jest.Mock };

  const tenantId = '00000000-0000-4000-8000-000000000001';
  const comprobanteId = 'c0000001-0001-4001-8001-000000000003';

  const baseComprobante = {
    id: comprobanteId,
    tenantId,
    sucursalId: 'd0000001-0001-4001-8001-000000000001',
    tipo: TipoComprobante.factura_a,
    estado: EstadoComprobante.pendiente_arca,
    cae: null,
    fecha: '2026-06-05',
    clienteId: null,
    numero: 3,
    pdfUrl: null,
    caeVencimiento: null,
  };

  beforeEach(async () => {
    comprobanteRepo = {
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    moduloRepo = {
      findOne: jest.fn().mockResolvedValue({ facturadorArca: true }),
    };
    arcaConfigRepo = {
      findOne: jest.fn().mockResolvedValue({ cuitEmisor: '20123456789', puntoDeVenta: 1 }),
    };
    arcaWsfe = { solicitarCae: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ComprobanteRetryArcaService,
        { provide: getRepositoryToken(Comprobante), useValue: comprobanteRepo },
        { provide: getRepositoryToken(Cliente), useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(ModuloConfig), useValue: moduloRepo },
        { provide: getRepositoryToken(ArcaConfig), useValue: arcaConfigRepo },
        { provide: TenantContext, useValue: { getTenantId: () => tenantId } },
        { provide: ArcaWsfeService, useValue: arcaWsfe },
      ],
    }).compile();

    service = module.get(ComprobanteRetryArcaService);
  });

  it('returns CAE data when WSFE approves', async () => {
    comprobanteRepo.findOne
      .mockResolvedValueOnce(baseComprobante)
      .mockResolvedValueOnce({
        ...baseComprobante,
        estado: EstadoComprobante.emitido,
        cae: '70123456789012',
        caeVencimiento: '2026-07-01',
        pdfUrl: 'https://cdn.example/pdf.pdf',
      });
    arcaWsfe.solicitarCae.mockResolvedValue({
      data: {
        estado: 'aprobado',
        cae: '70123456789012',
        caeVencimiento: '2026-07-01',
        errores: [],
        observaciones: [],
        pdf: { generated: true, sizeBytes: 1000, pdfUrl: 'https://cdn.example/pdf.pdf' },
      },
    });

    const res = await service.retryArca(comprobanteId);

    expect(arcaWsfe.solicitarCae).toHaveBeenCalledWith({
      comprobanteId,
      clienteDocumento: undefined,
    });
    expect(res.data).toMatchObject({
      cae: '70123456789012',
      caeVencimiento: '2026-07-01',
      pdfUrl: 'https://cdn.example/pdf.pdf',
      estado: EstadoComprobante.emitido,
      numero: 3,
    });
  });

  it('rejects non-fiscal comprobante types', async () => {
    comprobanteRepo.findOne.mockResolvedValue({
      ...baseComprobante,
      tipo: TipoComprobante.ticket,
    });

    await expect(service.retryArca(comprobanteId)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when facturador ARCA is disabled', async () => {
    moduloRepo.findOne.mockResolvedValue({ facturadorArca: false });

    await expect(service.retryArca(comprobanteId)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws 503 on network/pending WSFE result', async () => {
    comprobanteRepo.findOne.mockResolvedValue(baseComprobante);
    arcaWsfe.solicitarCae.mockResolvedValue({
      data: {
        estado: 'pendiente',
        cae: null,
        caeVencimiento: null,
        errores: [{ codigo: 'NETWORK', mensaje: 'timeout' }],
        observaciones: [],
      },
    });

    await expect(service.retryArca(comprobanteId)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('throws 422 on WSFE rejection', async () => {
    comprobanteRepo.findOne.mockResolvedValue({
      ...baseComprobante,
      estado: EstadoComprobante.error_arca,
    });
    arcaWsfe.solicitarCae.mockResolvedValue({
      data: {
        estado: 'rechazado',
        cae: null,
        caeVencimiento: null,
        errores: [{ codigo: '10016', mensaje: 'Cbte fuera de rango' }],
        observaciones: [],
      },
    });

    await expect(service.retryArca(comprobanteId)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('normalizes emitido without CAE before retry', async () => {
    comprobanteRepo.findOne
      .mockResolvedValueOnce({
        ...baseComprobante,
        estado: EstadoComprobante.emitido,
      })
      .mockResolvedValueOnce({
        ...baseComprobante,
        estado: EstadoComprobante.error_arca,
        numero: null,
      })
      .mockResolvedValueOnce({
        ...baseComprobante,
        estado: EstadoComprobante.emitido,
        cae: '70123456789012',
      });
    arcaWsfe.solicitarCae.mockResolvedValue({
      data: {
        estado: 'aprobado',
        cae: '70123456789012',
        caeVencimiento: '2026-07-01',
        errores: [],
        observaciones: [],
      },
    });

    await service.retryArca(comprobanteId);

    expect(comprobanteRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({ estado: EstadoComprobante.emitido }),
      expect.objectContaining({ estado: EstadoComprobante.error_arca, numero: null }),
    );
  });

  it('throws NotFound when comprobante is missing', async () => {
    comprobanteRepo.findOne.mockResolvedValue(null);

    await expect(service.retryArca(comprobanteId)).rejects.toBeInstanceOf(NotFoundException);
  });
});
