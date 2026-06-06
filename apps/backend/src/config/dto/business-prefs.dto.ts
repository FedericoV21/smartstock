import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsObject, IsOptional, IsString, IsUUID, ValidateIf } from 'class-validator';

export class PatchBusinessPrefsDto {
  @ApiPropertyOptional({ enum: ['tenant'] })
  @IsOptional()
  @IsString()
  scope?: 'tenant';

  @ApiPropertyOptional({ name: 'sucursal_id' })
  @IsOptional()
  @IsUUID()
  sucursal_id?: string;

  @ApiPropertyOptional({ name: 'inherit_from_tenant' })
  @IsOptional()
  @IsBoolean()
  inherit_from_tenant?: boolean;

  @ApiPropertyOptional({ name: 'business_prefs' })
  @ValidateIf((o: PatchBusinessPrefsDto) => o.inherit_from_tenant !== true)
  @IsOptional()
  @IsObject()
  business_prefs?: Record<string, unknown>;
}

export class BusinessPrefsQueryDto {
  @ApiPropertyOptional({ name: 'for_config' })
  @IsOptional()
  @IsString()
  for_config?: string;

  @ApiPropertyOptional({ name: 'sucursal_id' })
  @IsOptional()
  @IsUUID()
  sucursal_id?: string;
}
