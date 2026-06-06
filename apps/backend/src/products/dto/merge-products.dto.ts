import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsUUID,
} from 'class-validator';

export class MergeProductsDto {
  @ApiProperty({ description: 'Producto que permanece (alias: survivor_id)' })
  @IsUUID()
  @Transform(({ value, obj }) => value ?? obj.survivor_id)
  survivorId!: string;

  @ApiProperty({
    type: [String],
    minItems: 1,
    maxItems: 1,
    description: 'Exactamente un producto a fusionar (alias: loser_ids)',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1)
  @IsUUID('4', { each: true })
  @Transform(({ value, obj }) => value ?? obj.loser_ids)
  loserIds!: string[];

  @ApiPropertyOptional({
    description: 'Preferencias por campo (survivor/loser/max/merge). Alias snake_case del front.',
  })
  @IsOptional()
  @IsObject()
  campos?: Record<string, unknown>;

  @ApiPropertyOptional({ default: false, description: 'Solo preview sin persistir (alias: dry_run)' })
  @IsOptional()
  @Transform(({ value, obj }) => {
    const raw = value ?? obj.dry_run;
    return raw === true || raw === 'true' || raw === '1';
  })
  @IsBoolean()
  dryRun?: boolean;
}
