import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';

export class UpsertBranchPluDto {
  @ApiProperty()
  @IsUUID()
  sucursalId: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'null o vac├¡o elimina override (hereda producto.plu)',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(5)
  plu?: string | null;
}
