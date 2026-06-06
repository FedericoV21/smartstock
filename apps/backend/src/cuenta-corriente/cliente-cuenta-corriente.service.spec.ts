import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { Cliente } from '../catalog/entities/cliente.entity';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { Tenant } from '../config/entities/tenant.entity';
import { ComprobanteItem } from '../facturacion/entities/comprobante-item.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { CuentaCorriente } from '../importaciones/entities/cuenta-corriente.entity';
import { Producto } from '../products/entities/producto.entity';
import { ClienteCuentaCorrienteService } from './cliente-cuenta-corriente.service';
import { Pago } from './entities/pago.entity';
import { CobroModalidad } from './enums/cobro-modalidad.enum';

describe('ClienteCuentaCorrienteService', () => {
  let service: ClienteCuentaCorrienteService;
  let clienteRepo: jest.Mocked<Pick<Repository<Cliente>, 'findOne'>>;
  let cuentaRepo: jest.Mocked<Pick<Repository<CuentaCorriente>, 'findOne' | 'save' | 'update' | 'create'>>;
  let moduloRepo: jest.Mocked<Pick<Repository<ModuloConfig>, 'findOne'>>;

  beforeEach(async () => {
    clienteRepo = { findOne: jest.fn() };
    cuentaRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      create: jest.fn((payload) => payload as CuentaCorriente),
    };
    moduloRepo = { findOne: jest.fn().mockResolvedValue({ facturadorSimple: true }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClienteCuentaCorrienteService,
        { provide: DataSource, useValue: { query: jest.fn(), transaction: jest.fn() } },
        { provide: getRepositoryToken(Cliente), useValue: clienteRepo },
        { provide: getRepositoryToken(CuentaCorriente), useValue: cuentaRepo },
        { provide: getRepositoryToken(Pago), useValue: {} },
        { provide: getRepositoryToken(Comprobante), useValue: { createQueryBuilder: jest.fn() } },
        { provide: getRepositoryToken(ComprobanteItem), useValue: {} },
        { provide: getRepositoryToken(Producto), useValue: {} },
        { provide: getRepositoryToken(Sucursal), useValue: {} },
        { provide: getRepositoryToken(Tenant), useValue: {} },
        { provide: getRepositoryToken(ModuloConfig), useValue: moduloRepo },
        { provide: TenantContext, useValue: { getTenantId: jest.fn().mockReturnValue('tenant-1') } },
      ],
    }).compile();

    service = module.get(ClienteCuentaCorrienteService);
  });

  it('rechaza si facturador_simple est├í deshabilitado', async () => {
    moduloRepo.findOne.mockResolvedValue({ facturadorSimple: false } as ModuloConfig);
    await expect(service.getCuenta('c1')).rejects.toThrow(ForbiddenException);
  });

  it('retorna cuenta null si el cliente no tiene CC', async () => {
    clienteRepo.findOne.mockResolvedValue({ id: 'c1', nombre: 'Cliente' } as Cliente);
    cuentaRepo.findOne.mockResolvedValue(null);
    const res = await service.getCuenta('c1');
    expect(res.data.cuenta).toBeNull();
  });

  it('crea cuenta al patch si no existe', async () => {
    clienteRepo.findOne.mockResolvedValue({ id: 'c1', nombre: 'Cliente' } as Cliente);
    cuentaRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'cc1',
      tenantId: 'tenant-1',
      clienteId: 'c1',
      saldo: '0',
      tipoCuenta: 'cliente',
      cobroModalidad: CobroModalidad.por_comprobante,
      cobroDiasPlazo: 7,
      cobroPeriodicidad: null,
      cobroDiaVencimientoMes: null,
      cobroMontoMinimo: '0',
      limiteCredito: null,
    } as CuentaCorriente);
    cuentaRepo.save.mockImplementation(async (e) => e as CuentaCorriente);

    const res = await service.patchCuenta('c1', { cobro_dias_plazo: 15 });
    expect(cuentaRepo.save).toHaveBeenCalled();
    expect(res.data.cuenta?.cobro_dias_plazo).toBe(15);
  });

  it('404 si cliente no existe', async () => {
    clienteRepo.findOne.mockResolvedValue(null);
    await expect(service.getCuenta('c1')).rejects.toThrow(NotFoundException);
  });
});
