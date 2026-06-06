import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';

import { LoteIngresoOrigen } from '../enums/lote-ingreso-origen.enum';

export class CreateProductoLoteDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sucursalId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  proveedorId?: string | null;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cantidad: number;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  fechaVencimiento?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  precioCosto?: number | null;

  @ApiPropertyOptional({ enum: LoteIngresoOrigen, default: LoteIngresoOrigen.manual })
  @IsOptional()
  @IsEnum(LoteIngresoOrigen)
  origen?: LoteIngresoOrigen;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  movimientoId?: string | null;
}
