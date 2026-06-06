import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsUUID,
} from 'class-validator';

export class MergeSuppliersDto {
  @ApiProperty({ description: 'Proveedor que permanece (alias: survivor_id)' })
  @IsUUID()
  @Transform(({ value, obj }) => value ?? obj.survivor_id)
  survivorId!: string;

  @ApiProperty({
    type: [String],
    minItems: 1,
    description: 'Uno o m├ís proveedores a fusionar y eliminar (alias: loser_ids)',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  @Transform(({ value, obj }) => value ?? obj.loser_ids)
  loserIds!: string[];

  @ApiPropertyOptional({ default: false, description: 'Solo simulaci├│n sin persistir (alias: dry_run)' })
  @IsOptional()
  @Transform(({ value, obj }) => {
    const raw = value ?? obj.dry_run;
    return raw === true || raw === 'true' || raw === '1';
  })
  @IsBoolean()
  dryRun?: boolean;
}
