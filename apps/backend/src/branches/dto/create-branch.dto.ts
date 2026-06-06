import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateBranchDto {
  @ApiProperty({ example: 'CASA' })
  @IsString()
  @MaxLength(32)
  codigo: string;

  @ApiProperty({ example: 'Sucursal Principal' })
  @IsString()
  @MaxLength(200)
  nombre: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  direccion?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  activa?: boolean = true;

  @ApiPropertyOptional({
    enum: ['copiar_negocio', 'personalizar_vacio'],
    default: 'copiar_negocio',
  })
  @IsOptional()
  @IsIn(['copiar_negocio', 'personalizar_vacio'])
  perfilTicket?: 'copiar_negocio' | 'personalizar_vacio' = 'copiar_negocio';
}
