import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';

import { TipoPago } from '../enums/tipo-pago.enum';

export class RegistrarPagoDto {
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
  referencia?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notas?: string;
}
