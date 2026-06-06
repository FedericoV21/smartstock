import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';

import { ImportPreviewOrigen } from './import-preview-request.dto';

export enum SupplierObligationModo {
  CONDICION = 'condicion',
  FECHA_FIJA = 'fecha_fija',
}

export class CreateSupplierObligationDto {
  @ApiProperty()
  @IsUUID()
  proveedorId: string;

  @ApiProperty({ minimum: 0.01 })
  @IsNumber()
  @Min(0.01)
  monto: number;

  @ApiProperty({ enum: SupplierObligationModo })
  @IsEnum(SupplierObligationModo)
  modo: SupplierObligationModo;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fechaOperacionYmd?: string;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD, requerido si modo=fecha_fija' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  vencimientoYmd?: string | null;

  @ApiPropertyOptional({ default: 'Importaci├│n de lista' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  referencia?: string;

  @ApiPropertyOptional({ enum: ImportPreviewOrigen, default: ImportPreviewOrigen.IMPORTACION_EXCEL })
  @IsOptional()
  @IsEnum(ImportPreviewOrigen)
  origenPrecio?: ImportPreviewOrigen = ImportPreviewOrigen.IMPORTACION_EXCEL;
}
