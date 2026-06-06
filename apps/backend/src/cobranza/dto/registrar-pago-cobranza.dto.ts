import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class RegistrarPagoCobranzaDto {
  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  monto: number;

  @ApiPropertyOptional({ default: 'efectivo' })
  @IsOptional()
  @IsString()
  tipo_pago?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notas?: string | null;

  @ApiPropertyOptional({
    default: true,
    description: 'Si es false, no se genera comprobante recibo (solo cobro)',
  })
  @IsOptional()
  @IsBoolean()
  emitir_recibo?: boolean;
}
