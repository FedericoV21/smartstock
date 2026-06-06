import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class PosBuscarProductosQueryDto {
  @IsOptional()
  @IsUUID()
  sucursal_id?: string;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsUUID()
  proveedor_id?: string;
}

export class PosCatalogoBusquedaQueryDto {
  @IsOptional()
  @IsUUID()
  sucursal_id?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  offset?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number;
}

export class PosBuscarPromocionesQueryDto {
  @IsOptional()
  @IsUUID()
  sucursal_id?: string;

  @IsOptional()
  @IsString()
  q?: string;
}

export class PosSeleccionProductoDto {
  @IsUUID()
  producto_id!: string;

  @IsOptional()
  @IsUUID()
  producto_variante_id?: string;
}

export class PosProductosPorIdsDto {
  @IsOptional()
  @IsUUID()
  sucursal_id?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  producto_ids?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PosSeleccionProductoDto)
  selecciones?: PosSeleccionProductoDto[];
}

export class PosBorradorItemDto {
  @IsUUID()
  producto_id!: string;

  @IsOptional()
  @IsUUID()
  producto_variante_id?: string;

  @IsNumber()
  @Min(0.001)
  cantidad!: number;

  @IsNumber()
  @Min(0)
  precio_unitario!: number;
}

export class CrearBorradorPosDto {
  @IsOptional()
  @IsUUID()
  sucursal_id?: string;

  @IsOptional()
  @IsUUID()
  cliente_id?: string;

  @IsOptional()
  @IsString()
  caja_id?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PosBorradorItemDto)
  items!: PosBorradorItemDto[];

  @IsOptional()
  @IsBoolean()
  stock_bloqueante?: boolean;

  @IsOptional()
  @IsString()
  notas?: string;

  @IsOptional()
  @IsNumber()
  iva_porcentaje?: number;

  @IsOptional()
  @IsString()
  tipo_comprobante_pos?: 'ticket' | 'factura';
}

export class EliminarBorradorQueryDto {
  @IsUUID()
  id!: string;

  @IsOptional()
  @IsUUID()
  sucursal_id?: string;
}
