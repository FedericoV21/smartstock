import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class PatchPromocionDto {
  @ApiProperty()
  @IsBoolean()
  activa!: boolean;
}
