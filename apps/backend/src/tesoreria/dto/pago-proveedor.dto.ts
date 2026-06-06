import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

import { TipoPago } from '../../cuenta-corriente/enums/tipo-pago.enum';

export class PagoProveedorTesoreriaDto {
  @ApiProperty()
  @IsUUID()
  proveedor_id!: string;

  @ApiProperty()
  @IsNumber()
  @Min(0.01)
  monto!: number;

  @ApiPropertyOptional({ enum: TipoPago })
  @IsOptional()
  @IsEnum(TipoPago)
  tipo_pago?: TipoPago;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  cheque_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  pago_proveedor_factura_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notas?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  fecha?: string;
}
