import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { VariantBranchStockInputDto } from './variant-branch-stock-input.dto';

export class CreateProductoVarianteDto {
  @ApiPropertyOptional({ description: 'Atributos talle/color/material/medida' })
  @IsOptional()
  @IsObject()
  atributos?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  etiqueta?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  codigo?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  codigoBarras?: string | null;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  orden?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @ApiPropertyOptional({ type: [VariantBranchStockInputDto] })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => VariantBranchStockInputDto)
  branchStock?: VariantBranchStockInputDto[];
}
