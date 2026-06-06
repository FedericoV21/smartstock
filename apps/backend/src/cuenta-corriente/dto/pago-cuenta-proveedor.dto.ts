import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsString, Matches, Min } from 'class-validator';

import { TipoPago } from '../enums/tipo-pago.enum';

export class PagoCuentaProveedorDto {
  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  monto: number;

  @ApiPropertyOptional({ enum: TipoPago, default: TipoPago.efectivo })
  @IsOptional()
  @IsEnum(TipoPago)
  @Transform(({ value, obj }) => value ?? obj.tipo_pago)
  tipoPago?: TipoPago;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  referencia?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notas?: string | null;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fecha inv├ílida (us├í YYYY-MM-DD)' })
  fecha?: string | null;
}
