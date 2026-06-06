import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';

export class MpPointConfigQueryDto {
  @ApiPropertyOptional({ name: 'sucursal_id' })
  @IsOptional()
  @IsUUID()
  sucursal_id?: string;
}

export class PatchMpPointConfigDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  access_token?: string;

  @ApiPropertyOptional({ name: 'device_id' })
  @IsOptional()
  @IsString()
  device_id?: string | null;

  @ApiPropertyOptional({ name: 'webhook_secret' })
  @IsOptional()
  @IsString()
  webhook_secret?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  habilitado?: boolean;
}
