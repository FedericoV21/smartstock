import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';

export class UpsertImportDraftDto {
  @ApiProperty({
    description: 'Payload v1 del borrador (mapeo, headers, flags de preview)',
    type: 'object',
    additionalProperties: true,
  })
  @IsObject()
  payload: Record<string, unknown>;
}
