import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class ArcaTrayQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Filtrar por dep├│sito/sucursal' })
  @IsOptional()
  @IsUUID()
  sucursalId?: string;
}
