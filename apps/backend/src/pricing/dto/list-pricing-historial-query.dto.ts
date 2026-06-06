import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

import { OrigenPrecio } from '../enums/origen-precio.enum';

export class ListPricingHistorialQueryDto {
  @ApiPropertyOptional({ description: 'Alias front: producto_id' })
  @IsOptional()
  @IsUUID()
  @Transform(({ value, obj }) => value ?? obj.producto_id)
  productoId?: string;

  @ApiPropertyOptional({ enum: OrigenPrecio })
  @IsOptional()
  @IsEnum(OrigenPrecio)
  origen?: OrigenPrecio;

  @ApiPropertyOptional({ default: 1, minimum: 1, description: 'Alias front: pagina' })
  @IsOptional()
  @Type(() => Number)
  @Transform(({ value, obj }) => {
    const raw = value ?? obj.pagina;
    return raw != null ? Number(raw) : 1;
  })
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    default: 50,
    minimum: 1,
    maximum: 100,
    description: 'Alias front: por_pagina',
  })
  @IsOptional()
  @Type(() => Number)
  @Transform(({ value, obj }) => {
    const raw = value ?? obj.por_pagina;
    return raw != null ? Number(raw) : 50;
  })
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 50;
}
