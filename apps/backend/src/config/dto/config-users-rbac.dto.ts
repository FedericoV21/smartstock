import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

import { RolUsuario } from '../../users/enums/rol-usuario.enum';

export class CreateLocalUserDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  nombre: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  apellido: string;

  @ApiProperty({ description: 'Nombre de usuario local (sin espacios)' })
  @IsString()
  @MinLength(1)
  username: string;

  @ApiProperty({ description: 'PIN numérico de 4 a 8 dígitos' })
  @IsString()
  pin: string;

  @ApiPropertyOptional({ enum: RolUsuario })
  @IsOptional()
  @IsEnum(RolUsuario)
  rol?: RolUsuario;

  @ApiPropertyOptional({ description: 'Rol personalizado (UUID)' })
  @IsOptional()
  @IsUUID()
  rolId?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  sucursalIds?: string[];
}

export class PutUserSucursalesDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsUUID(undefined, { each: true })
  sucursalIds: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  defaultSucursalId?: string | null;
}

export class ChangeUserPinDto {
  @ApiProperty()
  @IsString()
  pin: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  pinTemporal?: boolean;
}

export class PatchUserPermisosExtraDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  permisos: string[];
}

export class PutUserPedidosWorkflowEstadosDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsUUID(undefined, { each: true })
  workflow_estado_ids: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  pedidos_puede_crear?: boolean;
}
