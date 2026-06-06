import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { Proveedor } from '../catalog/entities/proveedor.entity';
import { SupplierObligationModo } from './dto/create-supplier-obligation.dto';
import { CuentaCorriente } from './entities/cuenta-corriente.entity';
import { PagoProveedorFactura } from './entities/pago-proveedor-factura.entity';
import { ImportSupplierObligationService } from './import-supplier-obligation.service';

describe('ImportSupplierObligationService', () => {
  let service: ImportSupplierObligationService;
  let proveedorRepo: jest.Mocked<Pick<Repository<Proveedor>, 'findOne'>>;
  let obligacionRepo: jest.Mocked<Pick<Repository<PagoProveedorFactura>, 'save' | 'create'>>;
  let cuentaRepo: jest.Mocked<Pick<Repository<CuentaCorriente>, 'findOne'>>;

  beforeEach(async () => {
    proveedorRepo = { findOne: jest.fn() };
    cuentaRepo = { findOne: jest.fn().mockResolvedValue(null) };
    obligacionRepo = {
      create: jest.fn((v) => v as PagoProveedorFactura),
      save: jest.fn(async (v) => ({ ...v, id: 'obl-1' })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImportSupplierObligationService,
        { provide: getRepositoryToken(Proveedor), useValue: proveedorRepo },
        { provide: getRepositoryToken(CuentaCorriente), useValue: cuentaRepo },
        { provide: getRepositoryToken(PagoProveedorFactura), useValue: obligacionRepo },
        { provide: TenantContext, useValue: { getTenantId: jest.fn().mockReturnValue('tenant-1') } },
      ],
    }).compile();

    service = module.get(ImportSupplierObligationService);
  });

  it('creates import_lista obligation for contado proveedor', async () => {
    proveedorRepo.findOne.mockResolvedValue({
      id: 'prov-1',
      tenantId: 'tenant-1',
      condicionPagoDefault: 'contado',
      plazoPagoDias: null,
    } as Proveedor);

    const result = await service.create({
      proveedorId: 'prov-1',
      monto: 1250.5,
      modo: SupplierObligationModo.CONDICION,
      fechaOperacionYmd: '2026-06-01',
    });

    expect(result.data.id).toBe('obl-1');
    expect(obligacionRepo.save).toHaveBeenCalled();
    const saved = obligacionRepo.create.mock.calls[0][0];
    expect(saved.origen).toBe('import_lista');
    expect(saved.comprobanteId).toBeNull();
  });
});
