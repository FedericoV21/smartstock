import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';

export class PatchBorradorDto {
  @ApiProperty({ description: 'Payload v1 del borrador del lector' })
  @IsObject()
  payload: Record<string, unknown>;
}
