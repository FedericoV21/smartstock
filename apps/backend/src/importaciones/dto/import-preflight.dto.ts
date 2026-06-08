import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

class PreflightFilaDto {
  @ApiProperty({ name: 'fila_original' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  fila_original: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  codigo?: string | null;

  @ApiProperty()
  @IsString()
  nombre: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  unidad?: string | null;

  @ApiPropertyOptional({ name: 'codigo_barras' })
  @IsOptional()
  @IsString()
  codigo_barras?: string | null;
}

export class ImportPreflightDto {
  @ApiProperty({ type: [PreflightFilaDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PreflightFilaDto)
  filas: PreflightFilaDto[];

  @ApiPropertyOptional({ name: 'proveedor_id', nullable: true })
  @IsOptional()
  @IsUUID()
  proveedor_id?: string | null;

  @ApiPropertyOptional({ name: 'sucursal_id' })
  @IsOptional()
  @IsUUID()
  sucursal_id?: string | null;

  @ApiPropertyOptional({ name: 'forzar_productos_pesables' })
  @IsOptional()
  @IsBoolean()
  forzar_productos_pesables?: boolean;

  @ApiPropertyOptional({ name: 'aplicar_inferencia_pesable_por_nombre' })
  @IsOptional()
  @IsBoolean()
  aplicar_inferencia_pesable_por_nombre?: boolean;
}
