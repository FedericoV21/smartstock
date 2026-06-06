import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

import { CobroModalidad } from '../enums/cobro-modalidad.enum';
import { CobroPeriodicidad } from '../enums/cobro-periodicidad.enum';

export class PatchClienteCuentaCorrienteDto {
  @ApiPropertyOptional({ enum: ['cliente', 'empleado'] })
  @IsOptional()
  @IsString()
  tipo_cuenta?: 'cliente' | 'empleado';

  @ApiPropertyOptional({ enum: CobroModalidad })
  @IsOptional()
  @IsEnum(CobroModalidad)
  cobro_modalidad?: CobroModalidad;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  cobro_dias_plazo?: number;

  @ApiPropertyOptional({ enum: CobroPeriodicidad, nullable: true })
  @IsOptional()
  @IsEnum(CobroPeriodicidad)
  cobro_periodicidad?: CobroPeriodicidad | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(31)
  cobro_dia_vencimiento_mes?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cobro_monto_minimo?: number;
}
