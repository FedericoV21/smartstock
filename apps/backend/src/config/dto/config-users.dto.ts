import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsEnum, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

import { RolUsuario } from '../../users/enums/rol-usuario.enum';

export class InviteUserDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  nombre: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  apellido: string;

  @ApiProperty({ enum: [RolUsuario.operador, RolUsuario.visor] })
  @IsIn([RolUsuario.operador, RolUsuario.visor])
  rol: RolUsuario.operador | RolUsuario.visor;
}

export class PatchConfigUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  nombre?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  apellido?: string;

  @ApiPropertyOptional({ enum: RolUsuario })
  @IsOptional()
  @IsEnum(RolUsuario)
  rol?: RolUsuario;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
