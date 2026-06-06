import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class EffectiveBranchPricingQueryDto {
  @ApiPropertyOptional({ description: 'Dep├│sito; si omit├¡s usa sucursal activa del contexto' })
  @IsOptional()
  @IsUUID()
  sucursalId?: string;
}
