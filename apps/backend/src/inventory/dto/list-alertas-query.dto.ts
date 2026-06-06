import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class ListAlertasQueryDto {
  @ApiPropertyOptional({ default: 100, minimum: 1, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number = 100;

  @ApiPropertyOptional({
    description: 'Alertas del dep├│sito (stock_sucursal); sin valor usa sucursal activa',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  sucursalId?: string;
}
