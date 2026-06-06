import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

import { ListAlertasQueryDto } from './list-alertas-query.dto';

export class ListVencimientosAlertasQueryDto extends ListAlertasQueryDto {
  @ApiPropertyOptional({
    default: 30,
    description:
      'Incluye productos con fecha_vencimiento hasta hoy + N d├¡as (UTC). Incluye ya vencidos.',
    minimum: 0,
    maximum: 730,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(730)
  dias?: number = 30;
}
