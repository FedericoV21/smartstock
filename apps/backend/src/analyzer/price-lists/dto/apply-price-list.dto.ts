import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsNumber, IsOptional, IsUUID, Min, ValidateNested } from 'class-validator';

class ApplyPriceListItemVentaDto {
  @ApiPropertyOptional()
  @IsUUID()
  item_id!: string;

  @ApiPropertyOptional()
  @IsNumber()
  @Min(0)
  precio_venta!: number;
}

export class ApplyPriceListDto {
  @ApiPropertyOptional({ description: 'Marca aplicaci├│n parcial aunque no haya omitidos' })
  @IsOptional()
  @IsBoolean()
  parcial?: boolean;

  @ApiPropertyOptional({ description: 'Contribuir variaci├│n al radar de inflaci├│n' })
  @IsOptional()
  @IsBoolean()
  contribuir_radar?: boolean;

  @ApiPropertyOptional({ type: [ApplyPriceListItemVentaDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApplyPriceListItemVentaDto)
  precios_venta?: ApplyPriceListItemVentaDto[];
}
