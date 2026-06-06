import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';

import { ArcaAmbiente } from '../enums/arca-ambiente.enum';

export class UpsertArcaConfigDto {
  @ApiPropertyOptional({ description: 'Sucursal; si se omite, usa la activa del contexto' })
  @IsOptional()
  @IsUUID()
  sucursalId?: string;

  @ApiPropertyOptional({ description: 'Enviar __KEEP_EXISTING__ para conservar el certificado actual' })
  @IsOptional()
  @IsString()
  certificadoPem?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  clavePrivadaPem?: string;

  @ApiPropertyOptional({ example: '30-12345678-9' })
  @IsOptional()
  @IsString()
  @Length(11, 13)
  cuitEmisor?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 9999 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(9999)
  puntoDeVenta?: number;

  @ApiPropertyOptional({ enum: ArcaAmbiente, default: ArcaAmbiente.homologacion })
  @IsOptional()
  @IsEnum(ArcaAmbiente)
  ambiente?: ArcaAmbiente;
}
