import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsUUID } from 'class-validator';

export class MovimientosDiaQueryDto {
  @ApiPropertyOptional({ description: 'Alias front: sucursal_id' })
  @IsOptional()
  @IsUUID()
  @Transform(({ value, obj }) => value ?? obj.sucursal_id)
  sucursalId?: string;
}
