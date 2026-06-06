import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

import { EstadoComprobante } from '../enums/estado-comprobante.enum';
import { TipoComprobante } from '../enums/tipo-comprobante.enum';

export class ListComprobantesQueryDto {
  @ApiPropertyOptional({ enum: TipoComprobante })
  @IsOptional()
  @IsEnum(TipoComprobante)
  tipo?: TipoComprobante;

  @ApiPropertyOptional({ enum: EstadoComprobante })
  @IsOptional()
  @IsEnum(EstadoComprobante)
  estado?: EstadoComprobante;

  @ApiPropertyOptional({ description: 'Solo comprobantes con error/pendiente ARCA' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  soloFallas?: boolean = false;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  clienteId?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 25, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 25;
}
