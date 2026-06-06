import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { EstadoPedido } from '../enums/estado-pedido.enum';

export class CreateWorkflowEstadoDto {
  @ApiProperty({ example: 'en_preparacion' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  slug: string;

  @ApiProperty({ example: 'En preparaci├│n' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  nombre: string;

  @ApiPropertyOptional({ example: '#3B82F6' })
  @IsOptional()
  @IsString()
  @MaxLength(7)
  color?: string | null;

  @ApiProperty({ enum: EstadoPedido })
  @IsEnum(EstadoPedido)
  fase: EstadoPedido;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  orden?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
