import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';

export class MpQrConfigQueryDto {
  @ApiPropertyOptional({ name: 'sucursal_id' })
  @IsOptional()
  @IsUUID()
  sucursal_id?: string;
}

export class PatchMpQrConfigDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  access_token?: string;

  @ApiPropertyOptional({ name: 'user_id' })
  @IsOptional()
  @IsString()
  user_id?: string | null;

  @ApiPropertyOptional({ name: 'external_pos_id' })
  @IsOptional()
  @IsString()
  external_pos_id?: string | null;

  @ApiPropertyOptional({ name: 'webhook_secret' })
  @IsOptional()
  @IsString()
  webhook_secret?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  habilitado?: boolean;

  @ApiPropertyOptional({ name: 'transferencia_habilitada' })
  @IsOptional()
  @IsBoolean()
  transferencia_habilitada?: boolean;
}

export class VerificarMpQrConfigDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  access_token?: string;

  @ApiPropertyOptional({ name: 'user_id' })
  @IsString()
  user_id: string;

  @ApiPropertyOptional({ name: 'external_pos_id' })
  @IsString()
  external_pos_id: string;
}
