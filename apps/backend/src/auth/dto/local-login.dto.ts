import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class LocalLoginDto {
  @ApiPropertyOptional({ description: 'UUID del tenant (alternativa a tenantCode)' })
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @ApiPropertyOptional({ description: 'Código de acceso del negocio (alternativa a tenantId)' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  tenantCode?: string;

  @ApiProperty({ example: 'cajero_01' })
  @IsString()
  @MinLength(1)
  username: string;

  @ApiProperty({ description: 'PIN numérico de 4 a 8 dígitos' })
  @IsString()
  pin: string;
}
