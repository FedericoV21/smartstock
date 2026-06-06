import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { Proveedor } from '../catalog/entities/proveedor.entity';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { CuentaCorriente } from '../importaciones/entities/cuenta-corriente.entity';
import { PagoProveedorFactura } from '../importaciones/entities/pago-proveedor-factura.entity';
import { PagoProveedorMovimiento } from './entities/pago-proveedor-movimiento.entity';
import { Pago } from './entities/pago.entity';
import { CobroModalidad } from './enums/cobro-modalidad.enum';
import { ProveedorCuentaCorrienteService } from './proveedor-cuenta-corriente.service';

describe('ProveedorCuentaCorrienteService', () => {
  let service: ProveedorCuentaCorrienteService;
  let proveedorRepo: jest.Mocked<Pick<Repository<Proveedor>, 'findOne'>>;
  let cuentaRepo: jest.Mocked<Pick<Repository<CuentaCorriente>, 'findOne' | 'save' | 'update' | 'create'>>;
  let moduloRepo: jest.Mocked<Pick<Repository<ModuloConfig>, 'findOne'>>;

  beforeEach(async () => {
    proveedorRepo = { findOne: jest.fn() };
    cuentaRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      create: jest.fn((payload) => payload as CuentaCorriente),
    };
    moduloRepo = { findOne: jest.fn().mockResolvedValue({ stock: true }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProveedorCuentaCorrienteService,
        { provide: DataSource, useValue: { query: jest.fn(), transaction: jest.fn() } },
        { provide: getRepositoryToken(Proveedor), useValue: proveedorRepo },
        { provide: getRepositoryToken(CuentaCorriente), useValue: cuentaRepo },
        { provide: getRepositoryToken(Pago), useValue: { createQueryBuilder: jest.fn() } },
        { provide: getRepositoryToken(PagoProveedorFactura), useValue: { find: jest.fn() } },
        { provide: getRepositoryToken(PagoProveedorMovimiento), useValue: {} },
        { provide: getRepositoryToken(Comprobante), useValue: { find: jest.fn() } },
        { provide: getRepositoryToken(ModuloConfig), useValue: moduloRepo },
        { provide: TenantContext, useValue: { getTenantId: jest.fn().mockReturnValue('tenant-1') } },
      ],
    }).compile();

    service = module.get(ProveedorCuentaCorrienteService);
  });

  it('rechaza si stock est├í deshabilitado', async () => {
    moduloRepo.findOne.mockResolvedValue({ stock: false } as ModuloConfig);
    await expect(service.getCuenta('p1')).rejects.toThrow(ForbiddenException);
  });

  it('retorna cuenta null si el proveedor no tiene CC', async () => {
    proveedorRepo.findOne.mockResolvedValue({ id: 'p1', nombre: 'Arcor' } as Proveedor);
    cuentaRepo.findOne.mockResolvedValue(null);
    const res = await service.getCuenta('p1');
    expect(res.data.cuenta).toBeNull();
  });

  it('crea cuenta proveedor al patch si no existe', async () => {
    proveedorRepo.findOne.mockResolvedValue({ id: 'p1', nombre: 'Arcor' } as Proveedor);
    cuentaRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'cc1',
      tenantId: 'tenant-1',
      proveedorId: 'p1',
      clienteId: null,
      saldo: '0',
      tipoCuenta: 'proveedor',
      cobroModalidad: CobroModalidad.por_comprobante,
      cobroDiasPlazo: 7,
      cobroPeriodicidad: null,
      cobroDiaVencimientoMes: null,
      cobroMontoMinimo: '0',
      limiteCredito: null,
    } as CuentaCorriente);
    cuentaRepo.save.mockImplementation(async (row) => row as CuentaCorriente);

    const res = await service.patchCuenta('p1', { cobro_dias_plazo: 15 });
    expect(res.data.cuenta?.tipo_cuenta).toBe('proveedor');
    expect(cuentaRepo.save).toHaveBeenCalled();
  });

  it('lanza NotFoundException si el proveedor no existe', async () => {
    proveedorRepo.findOne.mockResolvedValue(null);
    await expect(service.getCuenta('p1')).rejects.toThrow(NotFoundException);
  });

  it('rechaza patch vac├¡o', async () => {
    proveedorRepo.findOne.mockResolvedValue({ id: 'p1', nombre: 'Arcor' } as Proveedor);
    await expect(service.patchCuenta('p1', {})).rejects.toThrow(BadRequestException);
  });
});
