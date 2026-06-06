import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, ValidateNested } from 'class-validator';

import { ListProductsQueryDto } from './list-products-query.dto';

/** Subconjunto de filtros del listado de productos (paridad bulk-por-filtro del front). */
export class BulkByFilterFiltrosDto extends ListProductsQueryDto {}

export class BulkByFilterDto {
  @ApiProperty({ description: 'true = reactivar, false = dar de baja' })
  @IsBoolean()
  activo!: boolean;

  @ApiProperty({ type: BulkByFilterFiltrosDto })
  @ValidateNested()
  @Type(() => BulkByFilterFiltrosDto)
  filtros!: BulkByFilterFiltrosDto;
}
