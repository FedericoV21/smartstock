import { ApiPropertyOptional } from '@nestjs/swagger';
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

  @ApiPropertyOptional({ name: 'sucursal_id' })
  @IsOptional()
  @IsUUID()
  sucursal_id?: string;

  @ApiPropertyOptional({ description: 'csv para exportar' })
  @IsOptional()
  @IsString()
  export?: string;
}
