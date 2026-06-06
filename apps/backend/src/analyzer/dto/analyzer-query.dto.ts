import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class AnalyzerMarginQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  @Transform(({ value, obj }) => value ?? obj.producto_id)
  productoId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  @Transform(({ value, obj }) => value ?? obj.categoria_id)
  categoriaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  desde?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  hasta?: string;
}

export class AnalyzerRankingQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  @Transform(({ value, obj }) => value ?? obj.categoria_id)
  categoriaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  desde?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  hasta?: string;
}

export class AnalyzerForecastQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  @Transform(({ value, obj }) => value ?? obj.categoria_id)
  categoriaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  @Transform(({ value, obj }) => value ?? obj.proveedor_id)
  proveedorId?: string;
}

export class AnalyzerRadarQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  periodo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  rubro?: string;
}
