import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { Cliente } from '../catalog/entities/cliente.entity';
import { ArcaTrayService } from './arca-tray.service';
import { Comprobante } from './entities/comprobante.entity';
import { EstadoComprobante } from './enums/estado-comprobante.enum';
import { TipoComprobante } from './enums/tipo-comprobante.enum';

describe('ArcaTrayService', () => {
  let service: ArcaTrayService;
  let comprobanteQb: {
    where: jest.Mock;
    andWhere: jest.Mock;
    orderBy: jest.Mock;
    addOrderBy: jest.Mock;
    take: jest.Mock;
    getMany: jest.Mock;
    getCount: jest.Mock;
  };
  let comprobanteRepo: { createQueryBuilder: jest.Mock };
  let clienteRepo: { find: jest.Mock };
  let sucursalRepo: { exist: jest.Mock };

  const tenantId = '00000000-0000-4000-8000-000000000001';
  const sucursalId = 'd0000001-0001-4001-8001-000000000001';
  const clienteId = 'a0000001-0001-4001-8001-000000000001';

  beforeEach(async () => {
    comprobanteQb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
      getCount: jest.fn().mockResolvedValue(0),
    };
    comprobanteRepo = {
      createQueryBuilder: jest.fn(() => comprobanteQb),
    };
    clienteRepo = { find: jest.fn().mockResolvedValue([]) };
    sucursalRepo = { exist: jest.fn().mockResolvedValue(true) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ArcaTrayService,
        { provide: getRepositoryToken(Comprobante), useValue: comprobanteRepo },
        { provide: getRepositoryToken(Cliente), useValue: clienteRepo },
        { provide: getRepositoryToken(Sucursal), useValue: sucursalRepo },
        { provide: TenantContext, useValue: { getTenantId: () => tenantId } },
      ],
    }).compile();

    service = module.get(ArcaTrayService);
  });

  it('listTray returns fiscal comprobantes with cliente and arca fields', async () => {
    const createdAt = new Date('2026-06-01T12:00:00.000Z');
    const ultimoIntento = new Date('2026-06-01T12:05:00.000Z');
    comprobanteQb.getMany.mockResolvedValue([
      {
        id: 'c0000001-0001-4001-8001-000000000003',
        tenantId,
        tipo: TipoComprobante.factura_a,
        estado: EstadoComprobante.pendiente_arca,
        total: '6050.00',
        numero: 3,
        numeroOrden: 3,
        createdAt,
        intentosArca: 1,
        ultimoErrorArcaCodigo: 'NETWORK',
        ultimoErrorArcaMensaje: 'Timeout WSFE',
        ultimoIntentoArcaAt: ultimoIntento,
        pdfUrl: null,
        sucursalId,
        clienteId,
      },
    ]);
    clienteRepo.find.mockResolvedValue([
      {
        id: clienteId,
        nombre: 'Cliente Demo',
        razonSocial: 'Demo SA',
        cuitDni: '20123456789',
        telefono: '1155551234',
      },
    ]);

    const res = await service.listTray();

    expect(comprobanteQb.andWhere).toHaveBeenCalledWith('c.estado IN (:...estados)', {
      estados: [EstadoComprobante.error_arca, EstadoComprobante.pendiente_arca],
    });
    expect(res.data).toHaveLength(1);
    expect(res.data[0]).toMatchObject({
      id: 'c0000001-0001-4001-8001-000000000003',
      tipo: TipoComprobante.factura_a,
      estado: EstadoComprobante.pendiente_arca,
      total: 6050,
      numeroOrden: 3,
      intentosArca: 1,
      ultimoErrorArcaCodigo: 'NETWORK',
      cliente: {
        id: clienteId,
        nombre: 'Cliente Demo',
        razonSocial: 'Demo SA',
        cuitDni: '20123456789',
      },
    });
  });

  it('listTray filters by sucursal when provided', async () => {
    await service.listTray(sucursalId);

    expect(sucursalRepo.exist).toHaveBeenCalledWith({
      where: { id: sucursalId, tenantId, activa: true },
    });
    expect(comprobanteQb.andWhere).toHaveBeenCalledWith('c.sucursal_id = :sucursalId', {
      sucursalId,
    });
  });

  it('getAlertCount returns count for banner', async () => {
    comprobanteQb.getCount.mockResolvedValue(2);

    const res = await service.getAlertCount();

    expect(res.data.count).toBe(2);
  });

  it('throws when sucursal filter is invalid', async () => {
    sucursalRepo.exist.mockResolvedValue(false);

    await expect(service.listTray(sucursalId)).rejects.toBeInstanceOf(NotFoundException);
  });
});
