import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

import { ProductoBarcodeTipo } from '../enums/producto-barcode-tipo.enum';

export class CreateProductoBarcodeDto {
  @ApiProperty({ enum: ProductoBarcodeTipo, example: ProductoBarcodeTipo.EAN13 })
  @IsEnum(ProductoBarcodeTipo)
  tipo: ProductoBarcodeTipo;

  @ApiProperty({ example: '4006381333931' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(32)
  valor: string;

  @ApiPropertyOptional({ default: false, description: 'Marca este c├│digo como principal del producto' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  esPrincipal?: boolean = false;
}
