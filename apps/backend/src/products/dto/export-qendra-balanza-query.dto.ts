import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

function toUuidArray(value: unknown): string[] | undefined {
  if (value == null || value === '') return undefined;
  const arr = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const x of arr) {
    const id = String(x ?? '').trim();
    if (id && !out.includes(id)) out.push(id);
  }
  return out.length > 0 ? out : undefined;
}

export class ExportQendraBalanzaQueryDto {
  @ApiPropertyOptional({ type: [String], format: 'uuid', name: 'categoria_ids' })
  @IsOptional()
  @Transform(({ value }) => toUuidArray(value))
  @IsUUID('4', { each: true })
  categoriaIds?: string[];

  @ApiPropertyOptional({ type: [String], format: 'uuid', name: 'producto_ids' })
  @IsOptional()
  @Transform(({ value }) => toUuidArray(value))
  @IsUUID('4', { each: true })
  productoIds?: string[];

  @ApiPropertyOptional({ name: 'categoria_id', deprecated: true })
  @IsOptional()
  @IsUUID()
  categoriaId?: string;

  @ApiPropertyOptional({ name: 'sector_fijo' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  sectorFijo?: string;

  @ApiPropertyOptional({ name: 'seccion', deprecated: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  seccion?: string;
}
