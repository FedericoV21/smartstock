import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBooleanString, IsEnum, IsOptional, IsUUID } from 'class-validator';

import { PromocionTipo } from '../enums/promocion-tipo.enum';

export class ListPromocionesQueryDto {
  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsBooleanString()
  activa?: string;

  @ApiPropertyOptional({ enum: PromocionTipo })
  @IsOptional()
  @IsEnum(PromocionTipo)
  tipo?: PromocionTipo;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  sucursalId?: string;
}
