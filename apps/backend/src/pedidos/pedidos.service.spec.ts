import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { BranchStockService } from '../branches/branch-stock.service';
import { ComprobanteItem } from '../facturacion/entities/comprobante-item.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { TipoComprobante } from '../facturacion/enums/tipo-comprobante.enum';
import { Producto } from '../products/entities/producto.entity';
import { PedidoItem } from './entities/pedido-item.entity';
import { Pedido } from './entities/pedido.entity';
import { EstadoPedido } from './enums/estado-pedido.enum';
import { PedidoWorkflowEstado } from './entities/pedido-workflow-estado.entity';
import { PedidoWorkflowService } from './pedido-workflow.service';
import { PedidosService } from './pedidos.service';

function wf(
  id: string,
  slug: string,
  fase: EstadoPedido,
  activo = true,
): PedidoWorkflowEstado {
  return {
    id,
    tenantId: 'tenant-1',
    slug,
    nombre: slug,
    color: null,
    fase,
    orden: 0,
    activo,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as PedidoWorkflowEstado;
}

describe('PedidosService', () => {
  let service: PedidosService;
  let workflowService: {
    assertPedidosModuleEnabled: jest.Mock;
    findEstadoById: jest.Mock;
    findEstadoBySlug: jest.Mock;
    hasTransition: jest.Mock;
    resolveEstadoIdBySlug: jest.Mock;
  };
  let pedidoRepo: jest.Mocked<Pick<Repository<Pedido>, 'findOne' | 'findAndCount' | 'update'>>;
  let pedidoItemRepo: jest.Mocked<Pick<Repository<PedidoItem>, 'find'>>;
  let productoRepo: jest.Mocked<Pick<Repository<Producto>, 'find'>>;
  let dataSourceMock: { query: jest.Mock; transaction: jest.Mock };

  beforeEach(async () => {
    pedidoRepo = {
      findOne: jest.fn(),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    } as unknown as typeof pedidoRepo;
    pedidoItemRepo = { find: jest.fn().mockResolvedValue([]) } as unknown as typeof pedidoItemRepo;
    productoRepo = { find: jest.fn().mockResolvedValue([]) } as unknown as typeof productoRepo;
    dataSourceMock = {
      query: jest.fn(),
      transaction: jest.fn(async (fn: (manager: any) => Promise<unknown>) =>
        fn({
          query: jest.fn().mockResolvedValue([]),
          create: (_: unknown, payload: unknown) => payload,
          save: jest.fn().mockResolvedValue({ id: 'c1', numero: 1 }),
          update: jest.fn().mockResolvedValue({ affected: 1 }),
        }),
      ),
    };

    workflowService = {
      assertPedidosModuleEnabled: jest.fn().mockResolvedValue(undefined),
      findEstadoById: jest.fn(),
      findEstadoBySlug: jest.fn(),
      hasTransition: jest.fn().mockResolvedValue(true),
      resolveEstadoIdBySlug: jest.fn().mockResolvedValue('wf-borrador'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PedidosService,
        { provide: DataSource, useValue: dataSourceMock },
        { provide: getRepositoryToken(Pedido), useValue: pedidoRepo },
        { provide: getRepositoryToken(PedidoItem), useValue: pedidoItemRepo },
        { provide: getRepositoryToken(Producto), useValue: productoRepo },
        { provide: getRepositoryToken(Comprobante), useValue: {} },
        { provide: getRepositoryToken(ComprobanteItem), useValue: {} },
        { provide: TenantContext, useValue: { getTenantId: jest.fn().mockReturnValue('tenant-1') } },
        {
          provide: BranchStockService,
          useValue: { resolveDepotId: jest.fn().mockResolvedValue('sucursal-1') },
        },
        { provide: PedidoWorkflowService, useValue: workflowService },
      ],
    }).compile();
    service = module.get(PedidosService);
  });

  it('rejects invalid fase transition', async () => {
    pedidoRepo.findOne.mockResolvedValue({
      id: 'p1',
      tenantId: 'tenant-1',
      estado: EstadoPedido.entregado,
      workflowEstadoId: 'w-entregado',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Pedido);
    workflowService.findEstadoById.mockImplementation(async (id: string) => {
      if (id === 'w-entregado') return wf('w-entregado', 'entregado', EstadoPedido.entregado);
      if (id === 'w-confirmado') return wf('w-confirmado', 'confirmado', EstadoPedido.confirmado);
      return null;
    });
    workflowService.findEstadoBySlug.mockResolvedValue(
      wf('w-confirmado', 'confirmado', EstadoPedido.confirmado),
    );

    await expect(
      service.changeEstado('p1', { workflowEstadoId: 'w-confirmado' }, 'u1'),
    ).rejects.toThrow('No se puede pasar');
  });

  it('rejects disallowed workflow transition', async () => {
    pedidoRepo.findOne.mockResolvedValue({
      id: 'p1',
      tenantId: 'tenant-1',
      estado: EstadoPedido.borrador,
      workflowEstadoId: 'w-borrador',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Pedido);
    workflowService.findEstadoById.mockImplementation(async (id: string) => {
      if (id === 'w-borrador') return wf('w-borrador', 'borrador', EstadoPedido.borrador);
      if (id === 'w-custom') return wf('w-custom', 'custom', EstadoPedido.borrador);
      return null;
    });
    workflowService.findEstadoBySlug.mockResolvedValue(wf('w-borrador', 'borrador', EstadoPedido.borrador));
    workflowService.hasTransition.mockResolvedValue(false);

    await expect(
      service.changeEstado('p1', { workflowEstadoId: 'w-custom' }, 'u1'),
    ).rejects.toThrow('Transici├│n no permitida');
  });

  it('applies stock movement when delivering confirmed pedido', async () => {
    pedidoRepo.findOne.mockResolvedValue({
      id: 'p1',
      tenantId: 'tenant-1',
      estado: EstadoPedido.confirmado,
      workflowEstadoId: 'w-confirmado',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Pedido);
    pedidoItemRepo.find.mockResolvedValue([{ productoId: 'prod-1', cantidad: '1.000' } as PedidoItem]);
    workflowService.findEstadoById.mockImplementation(async (id: string) => {
      if (id === 'w-confirmado') return wf('w-confirmado', 'confirmado', EstadoPedido.confirmado);
      if (id === 'w-entregado') return wf('w-entregado', 'entregado', EstadoPedido.entregado);
      return null;
    });
    workflowService.findEstadoBySlug.mockImplementation(async (slug: string) => {
      if (slug === 'entregado') return wf('w-entregado', 'entregado', EstadoPedido.entregado);
      return wf('w-confirmado', 'confirmado', EstadoPedido.confirmado);
    });

    await service.changeEstado('p1', { estado: EstadoPedido.entregado }, 'u1');
    expect(dataSourceMock.transaction).toHaveBeenCalled();
  });

  it('cambia workflow dentro de la misma fase sin tocar stock', async () => {
    pedidoRepo.findOne.mockResolvedValue({
      id: 'p1',
      tenantId: 'tenant-1',
      estado: EstadoPedido.confirmado,
      workflowEstadoId: 'w1',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Pedido);
    workflowService.findEstadoById.mockImplementation(async (id: string) => {
      if (id === 'w1') return wf('w1', 'confirmado', EstadoPedido.confirmado);
      if (id === 'w2') return wf('w2', 'en_preparacion', EstadoPedido.confirmado);
      return null;
    });
    workflowService.findEstadoBySlug.mockResolvedValue(wf('w1', 'confirmado', EstadoPedido.confirmado));

    await service.changeEstado('p1', { workflowEstadoId: 'w2' }, 'u1');
    expect(dataSourceMock.transaction).not.toHaveBeenCalled();
    expect(pedidoRepo.update).toHaveBeenCalledWith(
      { id: 'p1', tenantId: 'tenant-1' },
      expect.objectContaining({ workflowEstadoId: 'w2' }),
    );
  });

  it('factura only delivered pedido and links comprobante', async () => {
    dataSourceMock.transaction.mockImplementationOnce(async (fn: (manager: any) => Promise<unknown>) =>
      fn({
        query: jest.fn().mockResolvedValueOnce([{ numero: 11 }]).mockResolvedValue([]),
        create: (_: unknown, payload: unknown) => payload,
        save: jest.fn().mockResolvedValue({ id: 'c1', numero: 11 }),
        update: jest.fn().mockResolvedValue({ affected: 1 }),
      }),
    );
    pedidoRepo.findOne.mockResolvedValue({
      id: 'p1',
      tenantId: 'tenant-1',
      estado: EstadoPedido.entregado,
      clienteId: null,
      comprobanteId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Pedido);
    pedidoItemRepo.find.mockResolvedValue([
      { productoId: 'prod-1', cantidad: '1.000', precioUnitario: '100.00', subtotal: '100.00' } as PedidoItem,
    ]);
    productoRepo.find.mockResolvedValue([{ id: 'prod-1', precioCosto: '40.000000' } as Producto]);

    const res = await service.facturar('p1', { tipo: TipoComprobante.factura_c }, 'u1');
    expect(res.data.pedidoId).toBe('p1');
  });
});
