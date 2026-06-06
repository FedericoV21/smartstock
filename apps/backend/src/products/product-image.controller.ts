import {
  Controller,
  Delete,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';

import { Roles } from '../auth/decorators/roles.decorator';
import { ProductImageService } from './product-image.service';
import { PRODUCT_IMAGE_MAX_BYTES } from './utils/process-product-image';

@ApiTags('product-images')
@ApiBearerAuth('access-token')
@Controller('products/:productId/image')
export class ProductImageController {
  constructor(private readonly productImageService: ProductImageService) {}

  @Post()
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Subir miniatura WebP del producto',
    description:
      'Paridad con POST /api/productos/[id]/imagen. PNG/JPEG/WebP m├íx. 2 MB ÔåÆ WebP 256px en S3/R2.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: PRODUCT_IMAGE_MAX_BYTES },
    }),
  )
  upload(
    @Param('productId', ParseUUIDPipe) productId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.productImageService.upload(productId, file);
  }

  @Delete()
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Quitar imagen del producto',
    description: 'Elimina el objeto en storage (si est├í configurado) y pone imagenUrl en null.',
  })
  remove(@Param('productId', ParseUUIDPipe) productId: string) {
    return this.productImageService.remove(productId);
  }
}
