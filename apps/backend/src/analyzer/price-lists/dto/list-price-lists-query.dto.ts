import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';

import { EstadoListaPrecios } from '../enums/estado-lista-precios.enum';

export class ListPriceListsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  proveedor_id?: string;

  @ApiPropertyOptional({ enum: EstadoListaPrecios })
  @IsOptional()
  @IsEnum(EstadoListaPrecios)
  estado?: EstadoListaPrecios;
}
