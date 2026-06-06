import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

export class ListWorkflowEstadosQueryDto {
  @ApiPropertyOptional({
    description: 'Si es true, incluye estados inactivos (solo admin). Alias front: for_config=1',
  })
  @IsOptional()
  @Transform(({ value, obj }) => {
    const raw = value ?? obj.for_config;
    return raw === true || raw === 'true' || raw === '1' || raw === 1;
  })
  @IsBoolean()
  forConfig?: boolean;
}
