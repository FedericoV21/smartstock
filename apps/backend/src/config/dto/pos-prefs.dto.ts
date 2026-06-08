import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class PosPrefsQueryDto {
  @ApiPropertyOptional({ description: 'Pantalla configuración cuando es true' })
  @IsOptional()
  for_config?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sucursal_id?: string;
}

export class PatchPosPrefsDto {
  @ApiPropertyOptional({ enum: ['tenant'] })
  @IsOptional()
  scope?: 'tenant';

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sucursal_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  inherit_from_tenant?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  pos_prefs?: Record<string, unknown>;
}
