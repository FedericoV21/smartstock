import { OmitType, PartialType } from '@nestjs/swagger';

import { CreateProductoDto } from './create-producto.dto';

/** imagenUrl solo v├¡a POST/DELETE /products/:id/image (paridad front). */
export class UpdateProductoDto extends PartialType(OmitType(CreateProductoDto, ['imagenUrl'])) {}
