import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class CreateCajaDto {
  @ApiProperty()
  @IsUUID()
  sucursal_id: string;

  @ApiProperty()
  @IsString()
  @MaxLength(120)
  nombre: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  numero: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  usuario_default_id?: string | null;
}

export class PatchCajaDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nombre?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sucursal_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  activa?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  usuario_default_id?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(168)
  auto_cierre_horas?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  prefs?: Record<string, unknown>;
}

export class ListCajasQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sucursal_id?: string;
}
