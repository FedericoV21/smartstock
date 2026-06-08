import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class PasarelaIntegracionQueryDto {
  @ApiPropertyOptional({ name: 'sucursal_id' })
  @IsOptional()
  @IsUUID()
  sucursal_id?: string;
}

export class CreatePasarelaIntegracionDto {
  @ApiProperty({ name: 'sucursal_id' })
  @IsUUID()
  sucursal_id: string;

  @ApiProperty()
  @IsString()
  proveedor: string;

  @ApiProperty({ enum: ['qr', 'terminal'] })
  @IsIn(['qr', 'terminal'])
  canal: 'qr' | 'terminal';

  @ApiProperty()
  @IsString()
  tipo: string;

  @ApiProperty()
  @IsString()
  @MaxLength(120)
  nombre: string;

  @ApiPropertyOptional({ enum: ['activa', 'inactiva', 'incompleta'] })
  @IsOptional()
  @IsIn(['activa', 'inactiva', 'incompleta'])
  estado?: 'activa' | 'inactiva' | 'incompleta';

  @ApiPropertyOptional({ name: 'config_publica' })
  @IsOptional()
  @IsObject()
  config_publica?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  secretos?: Record<string, unknown>;
}

export class PatchPasarelaIntegracionByIdDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nombre?: string;

  @ApiPropertyOptional({ enum: ['activa', 'inactiva', 'incompleta'] })
  @IsOptional()
  @IsIn(['activa', 'inactiva', 'incompleta'])
  estado?: 'activa' | 'inactiva' | 'incompleta';

  @ApiPropertyOptional({ name: 'config_publica' })
  @IsOptional()
  @IsObject()
  config_publica?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  secretos?: Record<string, unknown>;
}

export class PatchPasarelaIntegracionDto extends PatchPasarelaIntegracionByIdDto {
  @ApiProperty()
  @IsUUID()
  id: string;
}

export class DeletePasarelaIntegracionQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  id?: string;
}

export class VerificarPasarelaIntegracionDto {
  @ApiPropertyOptional({ name: 'config_publica' })
  @IsOptional()
  @IsObject()
  config_publica?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  secretos?: Record<string, unknown>;
}
