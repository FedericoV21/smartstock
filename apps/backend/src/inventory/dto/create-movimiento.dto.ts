import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

import { ReferenciaTipo } from '../enums/referencia-tipo.enum';
import { TipoMovimiento } from '../enums/tipo-movimiento.enum';

export class CreateMovimientoDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  productoId: string;

  @ApiProperty({ enum: TipoMovimiento })
  @IsEnum(TipoMovimiento)
  tipo: TipoMovimiento;

  @ApiProperty({
    description:
      'Para entrada/salida es delta positiva. Para ajuste es el stock absoluto final (ver docs/base-de-datos.md).',
    example: 12.5,
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  cantidad: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  motivo?: string | null;

  @ApiPropertyOptional({ enum: ReferenciaTipo })
  @IsOptional()
  @IsEnum(ReferenciaTipo)
  referenciaTipo?: ReferenciaTipo | null;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  referenciaId?: string | null;

  @ApiPropertyOptional({
    description: 'Dep├│sito del movimiento; default: sucursal activa del contexto',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  sucursalId?: string;

  @ApiPropertyOptional({
    description:
      'Variante del producto (obligatorio si el producto usa variantes). Delega en registrar_movimiento_variante.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  productoVarianteId?: string;
}
