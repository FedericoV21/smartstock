import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class ListSlotsQueryDto {
  @ApiPropertyOptional({ name: 'sucursal_id' })
  @IsOptional()
  @IsUUID()
  sucursal_id?: string;

  @ApiProperty()
  @IsUUID()
  agenda_id: string;

  @ApiProperty({ example: '2026-06-01' })
  @IsString()
  desde: string;

  @ApiPropertyOptional({ example: '2026-06-07' })
  @IsOptional()
  @IsString()
  hasta?: string;
}
