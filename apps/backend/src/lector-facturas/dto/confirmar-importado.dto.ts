import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class CrearDesdeFacturaDto {
  @ApiProperty()
  @IsString()
  nombre: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  codigo?: string | null;
}

export class ConfirmarImportadoItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  producto_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => CrearDesdeFacturaDto)
  crear_desde_factura?: CrearDesdeFacturaDto;

  @ApiProperty()
  @IsNumber()
  @Min(0.001)
  cantidad: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  precio_unitario: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  precio_costo?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  iva_porcentaje?: number | null;
}

export class ConfirmarImportadoDto {
  @ApiProperty()
  @IsUUID()
  log_id: string;

  @ApiProperty({ enum: ['recibida', 'emitida', 'desconocida'] })
  @IsString()
  direccion: string;

  @ApiProperty({ enum: ['compra', 'venta'] })
  @IsString()
  tipo_operacion: string;

  @ApiProperty()
  @IsString()
  tipo_comprobante: string;

  @ApiProperty()
  @IsDateString()
  fecha: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  proveedor_id?: string | null;

  @ApiProperty({ type: [ConfirmarImportadoItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ConfirmarImportadoItemDto)
  items: ConfirmarImportadoItemDto[];

  @ApiProperty()
  @IsNumber()
  @Min(0)
  subtotal: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  iva_monto: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  total: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  actualizar_costos?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  afecta_stock?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  afecta_cuenta_corriente?: boolean;
}
