import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsOptional, IsString, Matches, Min } from 'class-validator';

import { TipoPago } from '../enums/tipo-pago.enum';

export class PatchPagoExtractoDto {
  @ApiProperty()
  @IsNumber()
  @Min(0.01)
  monto: number;

  @ApiProperty({ example: '2026-06-08' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fecha: string;

  @ApiPropertyOptional({ enum: TipoPago, default: TipoPago.efectivo })
  @IsOptional()
  @IsEnum(TipoPago)
  tipo_pago?: TipoPago;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  referencia?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notas?: string | null;
}
