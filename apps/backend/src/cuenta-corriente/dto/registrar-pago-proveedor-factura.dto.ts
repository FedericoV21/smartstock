import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsString, Matches, Min } from 'class-validator';

import { TipoPago } from '../enums/tipo-pago.enum';

export class RegistrarPagoProveedorFacturaDto {
  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  monto: number;

  @ApiPropertyOptional({ enum: TipoPago, default: TipoPago.efectivo })
  @IsOptional()
  @IsEnum(TipoPago)
  tipo_pago?: TipoPago;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notas?: string | null;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fecha inválida (usá YYYY-MM-DD)' })
  fecha?: string | null;
}
