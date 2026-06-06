import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { ImportConvertPdfService } from './import-convert-pdf.service';
import * as pdfATabla from './utils/pdf-a-tabla';

describe('ImportConvertPdfService', () => {
  let service: ImportConvertPdfService;
  let moduloRepo: { findOne: jest.Mock };

  beforeEach(async () => {
    moduloRepo = {
      findOne: jest.fn().mockResolvedValue({ importadorExcel: true, iaPrecios: false }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImportConvertPdfService,
        { provide: getRepositoryToken(ModuloConfig), useValue: moduloRepo },
        { provide: TenantContext, useValue: { getTenantId: jest.fn().mockReturnValue('tenant-1') } },
      ],
    }).compile();

    service = module.get(ImportConvertPdfService);
    jest.spyOn(pdfATabla, 'convertirPdfTextoATabla').mockResolvedValue({
      headers: ['Codigo', 'Nombre'],
      filas: [{ Codigo: 'A-1', Nombre: 'Demo' }],
      totalFilas: 1,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects when import modules are disabled', async () => {
    moduloRepo.findOne.mockResolvedValue({ importadorExcel: false, iaPrecios: false });
    await expect(
      service.convert({
        buffer: Buffer.from('%PDF'),
        size: 4,
        originalname: 'lista.pdf',
        mimetype: 'application/pdf',
      } as Express.Multer.File),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects missing file', async () => {
    await expect(service.convert(undefined)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects non-pdf mime and extension', async () => {
    await expect(
      service.convert({
        buffer: Buffer.from('x'),
        size: 1,
        originalname: 'lista.txt',
        mimetype: 'text/plain',
      } as Express.Multer.File),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns table data for valid pdf upload', async () => {
    const result = await service.convert({
      buffer: Buffer.from('%PDF'),
      size: 4,
      originalname: 'lista.pdf',
      mimetype: 'application/pdf',
    } as Express.Multer.File);

    expect(result.data.headers).toEqual(['Codigo', 'Nombre']);
    expect(result.data.totalFilas).toBe(1);
    expect(result.data.archivoNombre).toBe('lista.pdf');
    expect(pdfATabla.convertirPdfTextoATabla).toHaveBeenCalled();
  });
});
