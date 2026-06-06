import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class ExportQendraBalanzaDto {
  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  categoriaIds?: string[];

  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  productoIds?: string[];

  @ApiPropertyOptional({
    description: 'Si se indica, todas las filas usan este sector en lugar de la categor├¡a',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  sectorFijo?: string;
}
