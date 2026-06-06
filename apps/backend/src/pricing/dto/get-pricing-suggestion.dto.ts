import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class GetPricingSuggestionDto {
  @ApiProperty()
  @IsUUID()
  productoId: string;

  @ApiProperty({ description: 'Nuevo precio de costo para calcular sugerencia de venta' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  nuevoPrecioCosto: number;

  @ApiPropertyOptional({ description: 'Margen objetivo manual (si se env├¡a, sobreescribe estrategia)', minimum: 0, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(500)
  margenObjetivoPct?: number;
}
