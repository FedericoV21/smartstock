import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

import { TipoPago } from '../enums/tipo-pago.enum';

export class ObligacionPagoItemDto {
  @ApiProperty()
  @IsUUID()
  id: string;

  @ApiPropertyOptional({ description: 'Si se omite, se paga el saldo pendiente completo' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  monto?: number;
}

export class PagoMultipleProveedorDto {
  @ApiProperty({ type: [ObligacionPagoItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ObligacionPagoItemDto)
  obligaciones: ObligacionPagoItemDto[];

  @ApiPropertyOptional({ enum: TipoPago, default: TipoPago.efectivo })
  @IsOptional()
  @IsEnum(TipoPago)
  @Transform(({ value, obj }) => value ?? obj.tipo_pago)
  tipoPago?: TipoPago;

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
