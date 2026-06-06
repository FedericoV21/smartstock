import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';

import { TipoComprobante } from '../../facturacion/enums/tipo-comprobante.enum';

export class ConvertirAFacturaDto {
  @ApiPropertyOptional({ enum: [TipoComprobante.factura_a, TipoComprobante.factura_b, TipoComprobante.factura_c] })
  @IsOptional()
  @IsEnum(TipoComprobante)
  tipo?: TipoComprobante.factura_a | TipoComprobante.factura_b | TipoComprobante.factura_c;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sucursal_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  stock_bloqueante?: boolean;
}

export class ConvertirATicketDto {
  @ApiPropertyOptional({ enum: ['efectivo', 'debito', 'credito', 'transferencia', 'cuenta_corriente'] })
  @IsOptional()
  @IsString()
  metodo_pago?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sucursal_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  stock_bloqueante?: boolean;
}
