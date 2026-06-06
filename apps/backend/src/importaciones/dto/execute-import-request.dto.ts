import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import { ImportPreviewOrigen } from './import-preview-request.dto';
import { ImportPreviewRowDto } from './import-preview-row.dto';

export class ExecuteImportRequestDto {
  @ApiPropertyOptional({
    type: [ImportPreviewRowDto],
    description: 'Omitir si se env├¡a draftId (filas se leen del borrador en BD).',
  })
  @ValidateIf((dto: ExecuteImportRequestDto) => !dto.draftId?.trim())
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => ImportPreviewRowDto)
  filas?: ImportPreviewRowDto[];

  @ApiPropertyOptional({ description: 'Borrador activo del que leer filas por chunks.' })
  @IsOptional()
  @IsUUID()
  draftId?: string;

  @ApiPropertyOptional({ default: 0, description: '├ìndice del primer chunk del borrador a procesar.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  draftChunkStart?: number;

  @ApiPropertyOptional({ default: 1, description: 'Cantidad de chunks del borrador a procesar en este lote.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  draftChunksToProcess?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  proveedorId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  archivoNombre?: string | null;

  @ApiPropertyOptional({ enum: ImportPreviewOrigen, default: ImportPreviewOrigen.IMPORTACION_EXCEL })
  @IsOptional()
  @IsEnum(ImportPreviewOrigen)
  origen?: ImportPreviewOrigen = ImportPreviewOrigen.IMPORTACION_EXCEL;

  @ApiPropertyOptional({ description: 'Agrupa lotes HTTP de una misma carga (prepare-confirmation).' })
  @IsOptional()
  @IsUUID()
  cargaId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  archivoMime?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  archivoTamano?: number | null;
}
