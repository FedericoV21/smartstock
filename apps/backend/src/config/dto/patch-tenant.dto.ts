import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

import { CondicionIva } from '../../catalog/enums/condicion-iva.enum';

export class PatchTenantDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  nombre?: string;

  @ApiPropertyOptional({ name: 'razon_social' })
  @IsOptional()
  @IsString()
  razon_social?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cuit?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  domicilio?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  telefono?: string | null;

  @ApiPropertyOptional({ name: 'horarios_atencion' })
  @IsOptional()
  @IsString()
  horarios_atencion?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  email?: string | null;

  @ApiPropertyOptional({ name: 'condicion_iva', enum: CondicionIva })
  @IsOptional()
  @IsEnum(CondicionIva)
  condicion_iva?: CondicionIva;

  @ApiPropertyOptional({ name: 'punto_de_venta' })
  @IsOptional()
  @IsInt()
  @Min(1)
  punto_de_venta?: number;

  @ApiPropertyOptional({ name: 'codigo_acceso' })
  @IsOptional()
  @IsString()
  codigo_acceso?: string | null;
}
