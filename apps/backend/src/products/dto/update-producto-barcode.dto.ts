import { PartialType } from '@nestjs/swagger';

import { CreateProductoBarcodeDto } from './create-producto-barcode.dto';

export class UpdateProductoBarcodeDto extends PartialType(CreateProductoBarcodeDto) {}
