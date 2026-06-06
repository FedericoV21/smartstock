import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsUUID, Min } from 'class-validator';

export class EmitComprobanteItemDto {
  @ApiProperty()
  @IsUUID()
  productoId: string;

  @ApiProperty({ minimum: 0.001 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  cantidad: number;

  @ApiPropertyOptional({ description: 'Si no viene, usa precioVenta actual del producto' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  precioUnitario?: number;
}
