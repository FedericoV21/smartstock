import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export class UpsertBranchPricingDto {
  @ApiProperty()
  @IsUUID()
  sucursalId: string;

  @ApiPropertyOptional({ nullable: true, description: 'null hereda producto.precio_costo' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  precioCosto?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'null hereda producto.precio_venta' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  precioVenta?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Si tiene valor, recalcula precioVenta desde costo + ganancia + IVA',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(999.99)
  porcentajeGanancia?: number | null;
}
