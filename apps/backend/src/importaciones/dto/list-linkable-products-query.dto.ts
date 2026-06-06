import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class ListLinkableProductsQueryDto {
  @ApiPropertyOptional({ description: 'Texto de b├║squeda (m├¡n. 2 caracteres si no hay normalizado)' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  proveedorId?: string;

  @ApiPropertyOptional({ description: '1 = solo productos sin proveedor' })
  @IsOptional()
  @IsIn(['1', '0'])
  sinProveedor?: '1' | '0';
}
