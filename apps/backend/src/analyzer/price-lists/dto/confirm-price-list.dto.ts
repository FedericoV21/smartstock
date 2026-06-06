import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import { OrigenPrecio } from '../../../pricing/enums/origen-precio.enum';

export class ConfirmPriceListItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  codigo_proveedor?: string;

  @ApiPropertyOptional({ description: 'Alias de nombre_raw del preview' })
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nombre_raw?: string;

  @ApiProperty({ description: 'Precio bruto extra├¡do (se aplica descuento al confirmar)' })
  @IsNumber()
  @Min(0)
  precio_lista!: number;
}

export class ConfirmPriceListDto {
  @ApiProperty()
  @IsUUID()
  proveedor_id!: string;

  @ApiPropertyOptional({ description: 'Nombre descriptivo (fallback: nombre_archivo)' })
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiPropertyOptional({ description: 'Nombre del archivo subido en preview' })
  @IsOptional()
  @IsString()
  nombre_archivo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sucursal_id?: string;

  @ApiPropertyOptional({ description: 'Descuento proveedor % aplicado una vez al guardar' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(99.99)
  descuento_proveedor_pct?: number;

  @ApiPropertyOptional({ description: 'Ruta en storage (preview)' })
  @IsOptional()
  @IsString()
  storage_path?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  mime_type?: string;

  @ApiPropertyOptional({ enum: OrigenPrecio })
  @IsOptional()
  @IsEnum(OrigenPrecio)
  origen?: OrigenPrecio;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  archivo_url?: string;

  @ApiProperty({ type: [ConfirmPriceListItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ConfirmPriceListItemDto)
  items!: ConfirmPriceListItemDto[];
}
