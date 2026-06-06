import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { TipoComprobante } from '../enums/tipo-comprobante.enum';

const TIPOS_MANUAL_COMPRA = new Set([
  TipoComprobante.factura_a,
  TipoComprobante.factura_b,
  TipoComprobante.factura_c,
  TipoComprobante.remito,
]);

export { TIPOS_MANUAL_COMPRA };

export class CrearProveedorCompraDto {
  @ApiProperty()
  @IsString()
  @MaxLength(255)
  razonSocial: string;

  @ApiProperty({ description: 'CUIT 11 d├¡gitos' })
  @IsString()
  @MaxLength(13)
  cuit: string;
}

export class CrearProductoDesdeFacturaDto {
  @ApiProperty()
  @IsString()
  @MaxLength(500)
  nombre: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  codigo?: string | null;
}

export class CompraProveedorManualItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  productoId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => CrearProductoDesdeFacturaDto)
  crearDesdeFactura?: CrearProductoDesdeFacturaDto;

  @ApiProperty()
  @IsNumber()
  @Min(0.001)
  cantidad: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  precioUnitario: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  precioCosto?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  ivaPorcentaje?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  unidadFactura?: string | null;
}

export class CompraProveedorManualDto {
  @ApiProperty({ enum: TipoComprobante })
  @IsEnum(TipoComprobante)
  tipoComprobante: TipoComprobante;

  @ApiProperty({ example: '2026-06-05' })
  @IsDateString()
  fecha: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  proveedorId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => CrearProveedorCompraDto)
  crearProveedor?: CrearProveedorCompraDto | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  puntoVenta?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  numeroDocumento?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cae?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  caeVencimiento?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  observaciones?: string | null;

  @ApiProperty({ type: [CompraProveedorManualItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CompraProveedorManualItemDto)
  items: CompraProveedorManualItemDto[];

  @ApiProperty()
  @IsNumber()
  @Min(0)
  subtotal: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  ivaMonto: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  percepcionIibbMonto?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  percepcionIvaMonto?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  impuestoInternoMonto?: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  total: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  importesManuales?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  actualizarCostos?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  afectaStock?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  afectaCuentaCorriente?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sucursalId?: string;
}
