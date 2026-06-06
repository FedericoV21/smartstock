import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

export class EnsureWsaaTicketDto {
  @ApiPropertyOptional({ default: false, description: 'Si true, fuerza renovaci├│n ignorando ticket vigente' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  forceRenew?: boolean = false;
}
