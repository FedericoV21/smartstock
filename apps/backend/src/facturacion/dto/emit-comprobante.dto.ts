import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { TipoComprobante } from '../enums/tipo-comprobante.enum';
import { EmitComprobanteItemDto } from './emit-comprobante-item.dto';

export class EmitComprobanteDto {
  @ApiProperty({ enum: TipoComprobante })
  @IsEnum(TipoComprobante)
  tipo: TipoComprobante;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  fecha?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  clienteId?: string | null;

  @ApiPropertyOptional({ minimum: 0, maximum: 100, description: 'Por defecto 21 para factura_a, 0 para el resto' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  ivaPorcentaje?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  medioPagoOpcionId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  metodoPago?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metodoPagoDetalle?: Record<string, unknown> | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  cajaId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notas?: string | null;

  @ApiProperty({ type: [EmitComprobanteItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => EmitComprobanteItemDto)
  items: EmitComprobanteItemDto[];

  @ApiPropertyOptional({ description: 'Sucursal emisora (conversiones desde presupuesto)' })
  @IsOptional()
  @IsUUID()
  sucursalId?: string;

  @ApiPropertyOptional({ description: 'Orden de venta compartida presupuesto/pedido/factura' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  numeroOrdenExplicito?: number;
}
