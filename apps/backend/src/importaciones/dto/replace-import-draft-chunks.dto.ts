import { ApiProperty } from '@nestjs/swagger';
import { IsArray } from 'class-validator';

export class ReplaceImportDraftChunksDto {
  @ApiProperty({
    description: 'Filas crudas del archivo (clave = header original)',
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  @IsArray()
  filas: Array<Record<string, string | number | null>>;
}
