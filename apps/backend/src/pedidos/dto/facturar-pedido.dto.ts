import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, Max, Min } from 'class-validator';

import { TipoComprobante } from '../../facturacion/enums/tipo-comprobante.enum';

export class FacturarPedidoDto {
  @ApiPropertyOptional({ enum: TipoComprobante, default: TipoComprobante.factura_c })
  @IsOptional()
  @IsEnum(TipoComprobante)
  tipo?: TipoComprobante = TipoComprobante.factura_c;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  ivaPorcentaje?: number;
}
