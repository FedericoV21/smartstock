import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { Producto } from './entities/producto.entity';
import { ProductImageService } from './product-image.service';
import { ProductImageS3StorageService } from './storage/product-image-s3.storage';
import * as processModule from './utils/process-product-image';

jest.mock('./utils/process-product-image', () => ({
  ...jest.requireActual('./utils/process-product-image'),
  processProductImagePreview: jest.fn(),
}));

describe('ProductImageService', () => {
  let service: ProductImageService;
  let productoRepo: { findOne: jest.Mock; save: jest.Mock };
  let storage: { isConfigured: jest.Mock; uploadPreview: jest.Mock; deletePreview: jest.Mock };
  let tenantContext: { getTenantId: jest.Mock };

  const producto = {
    id: 'prod-1',
    tenantId: 'tenant-1',
    imagenUrl: null,
    activo: true,
  } as Producto;

  beforeEach(async () => {
    productoRepo = {
      findOne: jest.fn().mockResolvedValue(producto),
      save: jest.fn().mockImplementation(async (p) => p),
    };
    storage = {
      isConfigured: jest.fn().mockReturnValue(true),
      uploadPreview: jest.fn().mockResolvedValue('https://cdn.example.com/t/preview.webp'),
      deletePreview: jest.fn().mockResolvedValue(undefined),
    };
    tenantContext = { getTenantId: jest.fn().mockReturnValue('tenant-1') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductImageService,
        { provide: getRepositoryToken(Producto), useValue: productoRepo },
        { provide: ProductImageS3StorageService, useValue: storage },
        { provide: TenantContext, useValue: tenantContext },
      ],
    }).compile();

    service = module.get(ProductImageService);
    (processModule.processProductImagePreview as jest.Mock).mockResolvedValue(Buffer.from('webp'));
  });

  it('upload rechaza si storage no est├í configurado', async () => {
    storage.isConfigured.mockReturnValue(false);
    await expect(
      service.upload('prod-1', { buffer: Buffer.from('x'), size: 1, mimetype: 'image/png' } as Express.Multer.File),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('upload rechaza formato inv├ílido', async () => {
    await expect(
      service.upload('prod-1', {
        buffer: Buffer.from('x'),
        size: 100,
        mimetype: 'image/gif',
      } as Express.Multer.File),
    ).rejects.toThrow(BadRequestException);
  });

  it('upload guarda imagenUrl tras procesar y subir', async () => {
    const res = await service.upload('prod-1', {
      buffer: Buffer.from('png'),
      size: 100,
      mimetype: 'image/png',
    } as Express.Multer.File);

    expect(storage.uploadPreview).toHaveBeenCalledWith('tenant-1', 'prod-1', expect.any(Buffer));
    expect(res.data.imagenUrl).toBe('https://cdn.example.com/t/preview.webp');
    expect(productoRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ imagenUrl: 'https://cdn.example.com/t/preview.webp' }),
    );
  });

  it('upload 404 si producto no existe', async () => {
    productoRepo.findOne.mockResolvedValue(null);
    await expect(
      service.upload('prod-1', {
        buffer: Buffer.from('x'),
        size: 1,
        mimetype: 'image/png',
      } as Express.Multer.File),
    ).rejects.toThrow(NotFoundException);
  });

  it('remove borra storage y limpia imagenUrl', async () => {
    const res = await service.remove('prod-1');
    expect(storage.deletePreview).toHaveBeenCalledWith('tenant-1', 'prod-1');
    expect(res.data.imagenUrl).toBeNull();
  });
});
