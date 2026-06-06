import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class ExtractoQueryDto {
  @ApiPropertyOptional({ default: 'mes' })
  @IsOptional()
  @IsString()
  periodo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  desde?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  hasta?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  @Transform(({ value, obj }) => value ?? obj.sucursal_id)
  sucursalId?: string;

  @ApiPropertyOptional({ description: 'csv para exportar' })
  @IsOptional()
  @IsString()
  export?: string;
}
