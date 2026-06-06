import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';

import { ImportPreviewRowDto } from './import-preview-row.dto';

export enum ImportPreviewOrigen {
  IMPORTACION_EXCEL = 'importacion_excel',
  IA_PDF = 'ia_pdf',
}

export class ImportPreviewRequestDto {
  @ApiProperty({ type: [ImportPreviewRowDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => ImportPreviewRowDto)
  filas: ImportPreviewRowDto[];

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
}
