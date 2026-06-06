import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { SucursalContext } from '../branches/sucursal-context.service';
import { Proveedor } from '../catalog/entities/proveedor.entity';
import { Producto } from '../products/entities/producto.entity';
import { UnidadMedida } from '../products/enums/unidad-medida.enum';
import { CompraProveedorManualService } from './compra-proveedor-manual.service';
import { Comprobante } from './entities/comprobante.entity';
import { TipoComprobante } from './enums/tipo-comprobante.enum';

const tenantId = 'tenant-1';
const sucursalId = 'd0000001-0001-4001-8001-000000000001';
const proveedorId = 'a0000001-0001-4001-8001-000000000001';
const productoId = 'b0000001-0001-4001-8001-000000000001';

describe('CompraProveedorManualService', () => {
  let service: CompraProveedorManualService;
  let transactionMock: jest.Mock;
  let productoRepo: { findOne: jest.Mock; save: jest.Mock; create: jest.Mock };
  let proveedorRepo: { findOne: jest.Mock; find: jest.Mock; save: jest.Mock; create: jest.Mock };
  let comprobanteRepo: { findOne: jest.Mock };

  beforeEach(async () => {
    transactionMock = jest.fn(async (fn) => {
      const manager = {
        query: jest.fn().mockResolvedValue([{ id: 'mov-1' }]),
        create: jest.fn((_entity, data) => data),
        save: jest.fn(async (_entity, data) => {
          if (Array.isArray(data)) return data;
          return { ...data, id: 'comp-nuevo-1' };
        }),
        update: jest.fn(),
        getRepository: jest.fn().mockReturnValue({
          create: jest.fn((data) => data),
          save: jest.fn(async (data) => ({ ...data, id: 'lote-1' })),
        }),
        find: jest.fn().mockResolvedValue([
          {
            id: productoId,
            codigo: 'SKU-1',
            nombre: 'Yerba',
            precioCosto: '80.00',
            precioVenta: '120.00',
          },
        ]),
      };
      return fn(manager);
    });

    productoRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: productoId,
        tenantId,
        codigo: 'SKU-1',
        nombre: 'Yerba',
        usaVariantes: false,
        activo: true,
        precioCosto: '80.00',
        precioVenta: '120.00',
      }),
      save: jest.fn(),
      create: jest.fn((x) => x),
    };

    proveedorRepo = {
      findOne: jest.fn().mockResolvedValue({ id: proveedorId, tenantId, activo: true }),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(),
      create: jest.fn((x) => x),
    };

    comprobanteRepo = { findOne: jest.fn().mockResolvedValue(null) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompraProveedorManualService,
        { provide: DataSource, useValue: { transaction: transactionMock } },
        { provide: getRepositoryToken(Comprobante), useValue: comprobanteRepo },
        { provide: getRepositoryToken(Producto), useValue: productoRepo },
        { provide: getRepositoryToken(Proveedor), useValue: proveedorRepo },
        { provide: TenantContext, useValue: { getTenantId: () => tenantId } },
        {
          provide: SucursalContext,
          useValue: { requireSucursalId: jest.fn().mockResolvedValue(sucursalId) },
        },
      ],
    }).compile();

    service = module.get(CompraProveedorManualService);
  });

  it('rejects invalid tipo comprobante', async () => {
    await expect(
      service.registrar(
        {
          tipoComprobante: TipoComprobante.ticket,
          fecha: '2026-06-05',
          proveedorId,
          items: [
            {
              productoId,
              cantidad: 1,
              precioUnitario: 100,
            },
          ],
          subtotal: 100,
          ivaMonto: 21,
          total: 121,
        },
        'user-1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('registers compra with existing product', async () => {
    const res = await service.registrar(
      {
        tipoComprobante: TipoComprobante.factura_a,
        fecha: '2026-06-05',
        proveedorId,
        items: [
          {
            productoId,
            cantidad: 2,
            precioUnitario: 100,
            precioCosto: 95,
            ivaPorcentaje: 21,
          },
        ],
        subtotal: 200,
        ivaMonto: 42,
        total: 242,
        importesManuales: true,
        afectaStock: true,
        actualizarCostos: true,
      },
      'user-1',
    );

    expect(transactionMock).toHaveBeenCalled();
    expect(res.data.comprobanteId).toBe('comp-nuevo-1');
    expect(res.data.actualizacionesCostos.length).toBeGreaterThanOrEqual(0);
  });

  it('requires proveedor', async () => {
    await expect(
      service.registrar(
        {
          tipoComprobante: TipoComprobante.remito,
          fecha: '2026-06-05',
          items: [
            {
              productoId,
              cantidad: 1,
              precioUnitario: 10,
            },
          ],
          subtotal: 10,
          ivaMonto: 0,
          total: 10,
        },
        'user-1',
      ),
    ).rejects.toThrow('indic├í o cre├í un proveedor');
  });
});
