import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsNumber, IsUUID, Max, Min } from 'class-validator';

import { GANANCIA_PCT_MAX } from '../utils/calcular-precio-venta';

export class BulkMarginDto {
  @ApiProperty({ type: [String], maxItems: 250 })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(250)
  @IsUUID('4', { each: true })
  ids!: string[];

  @ApiProperty({ example: 35, description: 'Alias front: porcentaje_ganancia' })
  @Type(() => Number)
  @Transform(({ value, obj }) => value ?? obj.porcentaje_ganancia)
  @IsNumber()
  @Min(0)
  @Max(GANANCIA_PCT_MAX)
  porcentajeGanancia!: number;
}
