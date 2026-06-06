import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class CajaDisponiblesQueryDto {
  @IsOptional()
  @IsUUID()
  sucursal_id?: string;
}

export class CajaTurnoActualQueryDto {
  @IsOptional()
  @IsUUID()
  sucursal_id?: string;
}

export class CajaCierreZQueryDto {
  @IsOptional()
  @IsUUID()
  sucursal_id?: string;

  @IsOptional()
  @IsString()
  fecha_operativa?: string;

  @IsOptional()
  @IsString()
  caja_id?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class CajaTurnosHistorialQueryDto {
  @IsOptional()
  @IsUUID()
  sucursal_id?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class CierresRecientesQueryDto {
  @IsOptional()
  @IsUUID()
  sucursal_id?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
