import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class CompareSuppliersQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  producto_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoria_id?: string;
}
