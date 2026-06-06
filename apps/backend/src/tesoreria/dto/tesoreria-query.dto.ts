import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class TesoreriaOverviewQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sucursal_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fecha_desde?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fecha_hasta?: string;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class ObligacionesQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sucursal_id?: string;

  @ApiProperty()
  @IsUUID()
  proveedor_id!: string;
}

export class ChequesQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sucursal_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  estado?: string;
}
