import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class AiPreviewRowDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  codigo?: string | null;

  @ApiProperty()
  @IsString()
  nombre!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  precioCosto?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  porcentajeGanancia?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  ivaPorcentaje?: number | null;
}

export class AiPreviewDto {
  @ApiProperty({ type: [AiPreviewRowDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AiPreviewRowDto)
  filas!: AiPreviewRowDto[];
}
