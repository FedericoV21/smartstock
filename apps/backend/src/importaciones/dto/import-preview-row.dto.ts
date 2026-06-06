import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

import { UnidadMedida } from '../../products/enums/unidad-medida.enum';

export class ImportPreviewRowDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  codigo?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  nombre?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  precioCosto?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  precioVenta?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  stockActual?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  stockMinimo?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  categoria?: string | null;

  @ApiPropertyOptional({ enum: UnidadMedida })
  @IsOptional()
  @IsEnum(UnidadMedida)
  unidad?: UnidadMedida | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fechaVencimiento?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  proveedorId?: string | null;

  @ApiPropertyOptional({ description: 'Barcode expl├¡cito en payload normalizado' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  codigoBarras?: string | null;

  @ApiPropertyOptional({ description: 'Alias de importaci├│n: ean' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  ean?: string | null;

  @ApiPropertyOptional({ description: 'Alias de importaci├│n: upc' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  upc?: string | null;

  @ApiPropertyOptional({ description: 'Alias de importaci├│n: barras' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  barras?: string | null;
}
