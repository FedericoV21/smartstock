import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class AnalyzerCuentaCorrientePagoDto {
  @ApiProperty()
  @IsUUID()
  cliente_id: string;

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
  referencia?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notas?: string | null;
}
