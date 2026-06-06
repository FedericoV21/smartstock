import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { BranchStockService } from '../branches/branch-stock.service';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { Cliente } from '../catalog/entities/cliente.entity';
import { Producto } from '../products/entities/producto.entity';
import { ArcaConfig } from '../arca/entities/arca-config.entity';
import { ArcaSolicitarCaeOrchestratorService } from '../arca/wsfe/arca-solicitar-cae-orchestrator.service';
import { EmitComprobanteDto } from './dto/emit-comprobante.dto';
import { ComprobanteItem } from './entities/comprobante-item.entity';
import { Comprobante } from './entities/comprobante.entity';
import { FacturacionService } from './facturacion.service';
import { FinanciacionEmitService } from './financiacion-emit.service';
import { ComprobantePdfRegenerationService } from './pdf/comprobante-pdf-regeneration.service';
import { ComprobantePdfService } from './pdf/comprobante-pdf.service';
import { EstadoComprobante } from './enums/estado-comprobante.enum';
import { TipoComprobante } from './enums/tipo-comprobante.enum';

describe('FacturacionService', () => {
  let service: FacturacionService;
  let productoRepo: jest.Mocked<Pick<Repository<Producto>, 'find'>>;
  let comprobanteRepo: jest.Mocked<Pick<Repository<Comprobante>, 'findAndCount' | 'findOne'>>;
  let comprobanteItemRepo: jest.Mocked<Pick<Repository<ComprobanteItem>, 'find'>>;
  let clienteRepo: jest.Mocked<Pick<Repository<Cliente>, 'find' | 'findOne'>>;
  let dataSourceMock: { transaction: jest.Mock };
  let managerMock: jest.Mocked<Pick<EntityManager, 'query' | 'create' | 'save'>>;
  let pdfServiceMock: { generateComprobantePdf: jest.Mock };
  let pdfRegenerationMock: {
    buildComprobantePdf: jest.Mock;
    persistComprobantePdfToStorage: jest.Mock;
    pdfFilename: jest.Mock;
  };

  beforeEach(async () => {
    productoRepo = {
      find: jest.fn(),
    } as unknown as typeof productoRepo;

    comprobanteRepo = {
      findAndCount: jest.fn(),
      findOne: jest.fn(),
    } as unknown as typeof comprobanteRepo;

    comprobanteItemRepo = {
      find: jest.fn(),
    } as unknown as typeof comprobanteItemRepo;

    clienteRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
    } as unknown as typeof clienteRepo;

    managerMock = {
      query: jest.fn(),
      create: jest.fn((_: unknown, payload: unknown) => payload as never),
      save: jest.fn(),
      findOne: jest.fn().mockResolvedValue(null),
    } as unknown as typeof managerMock;

    dataSourceMock = {
      transaction: jest.fn(async (fn: (manager: EntityManager) => Promise<unknown>) => fn(managerMock as never)),
    };
    pdfServiceMock = { generateComprobantePdf: jest.fn().mockResolvedValue(Buffer.from('%PDF')) };
    pdfRegenerationMock = {
      buildComprobantePdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4')),
      persistComprobantePdfToStorage: jest
        .fn()
        .mockResolvedValue({ sizeBytes: 8, pdfUrl: 'https://cdn.test/t.pdf' }),
      pdfFilename: jest.fn().mockReturnValue('factura_b_2.pdf'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FacturacionService,
        { provide: DataSource, useValue: dataSourceMock },
        { provide: getRepositoryToken(Comprobante), useValue: comprobanteRepo },
        { provide: getRepositoryToken(ComprobanteItem), useValue: comprobanteItemRepo },
        { provide: getRepositoryToken(Producto), useValue: productoRepo },
        { provide: getRepositoryToken(Cliente), useValue: clienteRepo },
        {
          provide: getRepositoryToken(ModuloConfig),
          useValue: { findOne: jest.fn().mockResolvedValue({ facturadorArca: false }) },
        },
        { provide: getRepositoryToken(ArcaConfig), useValue: { findOne: jest.fn().mockResolvedValue(null) } },
        {
          provide: ArcaSolicitarCaeOrchestratorService,
          useValue: { solicitarCaeYAsignarNumero: jest.fn() },
        },
        {
          provide: FinanciacionEmitService,
          useValue: {
            resolveForEmit: jest.fn().mockImplementation((_t, _d, importes) => ({
              importes,
              totalMercaderia: importes.total,
              financiacionMonto: 0,
              financiacionPorcentaje: 0,
              financiacionDescripcion: '',
              impTribArca: 0,
              medioPagoOpcionId: null,
              metodoPagoDetalle: null,
              esPagoMixto: false,
            })),
          },
        },
        { provide: ComprobantePdfService, useValue: pdfServiceMock },
        { provide: ComprobantePdfRegenerationService, useValue: pdfRegenerationMock },
        { provide: TenantContext, useValue: { getTenantId: jest.fn().mockReturnValue('tenant-1') } },
        {
          provide: BranchStockService,
          useValue: { resolveDepotId: jest.fn().mockResolvedValue('suc-1') },
        },
      ],
    }).compile();

    service = module.get(FacturacionService);
  });

  it('lists comprobantes excluding arca failures by default', async () => {
    const createdAt = new Date('2026-04-19T00:00:00.000Z');
    comprobanteRepo.findAndCount.mockResolvedValue([
      [
        {
          id: 'c1',
          tenantId: 'tenant-1',
          tipo: TipoComprobante.ticket,
          numero: 4,
          fecha: '2026-04-19',
          estado: EstadoComprobante.emitido,
          clienteId: null,
          subtotal: '890.00',
          ivaMonto: '0.00',
          ivaPorcentaje: '0.00',
          total: '890.00',
          createdAt,
          updatedAt: createdAt,
        } as Comprobante,
      ],
      1,
    ]);
    clienteRepo.find.mockResolvedValue([]);

    const res = await service.list({ page: 1, pageSize: 25 });

    expect(res.meta.total).toBe(1);
    expect(res.data[0]?.numero).toBe(4);
    expect(comprobanteRepo.findAndCount).toHaveBeenCalled();
  });

  it('returns comprobante detail with items', async () => {
    const createdAt = new Date('2026-04-19T00:00:00.000Z');
    comprobanteRepo.findOne.mockResolvedValue({
      id: 'c1',
      tenantId: 'tenant-1',
      tipo: TipoComprobante.ticket,
      numero: 4,
      fecha: '2026-04-19',
      estado: EstadoComprobante.emitido,
      clienteId: null,
      subtotal: '890.00',
      ivaMonto: '0.00',
      ivaPorcentaje: '0.00',
      total: '890.00',
      notas: null,
      metodoPago: 'tarjeta',
      metodoPagoDetalle: null,
      cajaId: null,
      cae: null,
      caeVencimiento: null,
      pdfUrl: null,
      usuarioId: 'u1',
      createdAt,
      updatedAt: createdAt,
    } as Comprobante);
    comprobanteItemRepo.find.mockResolvedValue([
      {
        id: 'i1',
        comprobanteId: 'c1',
        productoId: 'p1',
        cantidad: '1.000',
        precioUnitario: '890.00',
        precioCosto: '450.000000',
        subtotal: '890.00',
        createdAt,
      } as ComprobanteItem,
    ]);
    productoRepo.find.mockResolvedValue([
      { id: 'p1', codigo: 'LEC-001', nombre: 'Leche' } as Producto,
    ]);

    const res = await service.getById('c1');

    expect(res.data.items).toHaveLength(1);
    expect(res.data.items[0]?.productoCodigo).toBe('LEC-001');
  });

  it('emits factura with stock salida movements', async () => {
    productoRepo.find.mockResolvedValue([
      { id: 'p1', codigo: 'SKU1', nombre: 'Prod1', precioCosto: '10.000000', precioVenta: '20.00' } as Producto,
    ]);
    managerMock.query.mockResolvedValueOnce([{ numero: 123 }]).mockResolvedValue([]);
    managerMock.save
      .mockResolvedValueOnce({
        id: 'c1',
        tipo: TipoComprobante.factura_a,
        numero: 123,
        fecha: '2026-04-19',
        estado: 'emitido',
        createdAt: new Date('2026-04-19T00:00:00.000Z'),
      } as never)
      .mockResolvedValueOnce([] as never);

    const dto: EmitComprobanteDto = {
      tipo: TipoComprobante.factura_a,
      items: [{ productoId: 'p1', cantidad: 2 }],
    };
    const res = await service.emitir(dto, 'u1');

    expect(res.data.stockImpacto).toBe('salida');
    expect(res.data.pdf.generated).toBe(true);
    expect(managerMock.query).toHaveBeenCalledWith(
      expect.stringContaining('registrar_movimiento'),
      expect.arrayContaining(['tenant-1', 'p1', 'salida']),
    );
  });

  it('emits nota_credito with stock entrada movements', async () => {
    productoRepo.find.mockResolvedValue([
      { id: 'p1', codigo: 'SKU1', nombre: 'Prod1', precioCosto: '10.000000', precioVenta: '20.00' } as Producto,
    ]);
    managerMock.query.mockResolvedValueOnce([{ numero: 124 }]).mockResolvedValue([]);
    managerMock.save
      .mockResolvedValueOnce({
        id: 'c2',
        tipo: TipoComprobante.nota_credito_a,
        numero: 124,
        fecha: '2026-04-19',
        estado: 'emitido',
        createdAt: new Date('2026-04-19T00:00:00.000Z'),
      } as never)
      .mockResolvedValueOnce([] as never);

    await service.emitir(
      {
        tipo: TipoComprobante.nota_credito_a,
        items: [{ productoId: 'p1', cantidad: 1 }],
      },
      'u1',
    );

    expect(managerMock.query).toHaveBeenCalledWith(
      expect.stringContaining('registrar_movimiento'),
      expect.arrayContaining(['tenant-1', 'p1', 'entrada']),
    );
  });

  it('emits presupuesto without stock movements', async () => {
    productoRepo.find.mockResolvedValue([
      { id: 'p1', codigo: 'SKU1', nombre: 'Prod1', precioCosto: '10.000000', precioVenta: '20.00' } as Producto,
    ]);
    managerMock.query.mockResolvedValueOnce([{ numero: 125 }]).mockResolvedValue([]);
    managerMock.save
      .mockResolvedValueOnce({
        id: 'c3',
        tipo: TipoComprobante.presupuesto,
        numero: 125,
        fecha: '2026-04-19',
        estado: 'emitido',
        createdAt: new Date('2026-04-19T00:00:00.000Z'),
      } as never)
      .mockResolvedValueOnce([] as never);

    const res = await service.emitir(
      {
        tipo: TipoComprobante.presupuesto,
        items: [{ productoId: 'p1', cantidad: 1 }],
      },
      'u1',
    );

    expect(res.data.stockImpacto).toBe('sin_movimiento');
    expect(pdfServiceMock.generateComprobantePdf).toHaveBeenCalled();
    expect(
      managerMock.query.mock.calls.filter((call) => String(call[0]).includes('registrar_movimiento')).length,
    ).toBe(0);
  });

  it('retries once when numero unique conflict occurs', async () => {
    productoRepo.find.mockResolvedValue([
      { id: 'p1', codigo: 'SKU1', nombre: 'Prod1', precioCosto: '10.000000', precioVenta: '20.00' } as Producto,
    ]);

    const uniqueConflict = {
      driverError: { code: '23505', constraint: 'idx_comprobante_numero' },
      message: 'duplicate key value violates unique constraint idx_comprobante_numero',
    };
    dataSourceMock.transaction
      .mockRejectedValueOnce(uniqueConflict)
      .mockImplementationOnce(async (fn: (manager: EntityManager) => Promise<unknown>) => fn(managerMock as never));

    managerMock.query.mockResolvedValueOnce([{ numero: 126 }]).mockResolvedValue([]);
    managerMock.save
      .mockResolvedValueOnce({
        id: 'c4',
        tipo: TipoComprobante.factura_b,
        numero: 126,
        fecha: '2026-04-19',
        estado: 'emitido',
        createdAt: new Date('2026-04-19T00:00:00.000Z'),
      } as never)
      .mockResolvedValueOnce([] as never);

    const res = await service.emitir(
      { tipo: TipoComprobante.factura_b, items: [{ productoId: 'p1', cantidad: 1 }] },
      'u1',
    );

    expect(dataSourceMock.transaction).toHaveBeenCalledTimes(2);
    expect(res.data.numero).toBe(126);
  });

  it('downloads comprobante pdf buffer', async () => {
    comprobanteRepo.findOne.mockResolvedValue({
      id: 'c2',
      tipo: TipoComprobante.factura_b,
      numero: 2,
    } as Comprobante);

    const res = await service.downloadPdf('c2');
    expect(res.filename).toBe('factura_b_2.pdf');
    expect(res.buffer.toString()).toContain('%PDF');
  });

  it('regenerates pdf and returns storage metadata', async () => {
    comprobanteRepo.findOne.mockResolvedValue({ id: 'c2' } as Comprobante);

    const res = await service.regeneratePdf('c2');
    expect(res.data.generated).toBe(true);
    expect(res.data.pdfUrl).toBe('https://cdn.test/t.pdf');
    expect(pdfRegenerationMock.persistComprobantePdfToStorage).toHaveBeenCalledWith('tenant-1', 'c2');
  });
});
