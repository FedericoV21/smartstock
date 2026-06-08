import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CobrarReservaDto {
  @ApiPropertyOptional({ description: 'pos | facturacion_pos para devolver pos_payload' })
  @IsOptional()
  @IsString()
  destino?: string;

  @ApiPropertyOptional({ default: 'factura' })
  @IsOptional()
  @IsString()
  tipo?: string;

  @ApiPropertyOptional({ default: 'efectivo' })
  @IsOptional()
  @IsString()
  metodo_pago?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  medio_pago_opcion_id?: string | null;

  @ApiPropertyOptional({ example: '2026-07-01' })
  @IsOptional()
  @IsString()
  fecha_vencimiento_pago?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notas?: string | null;
}
