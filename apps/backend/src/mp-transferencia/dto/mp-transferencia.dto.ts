import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';

export class MpTransferenciaComprobanteDto {
  @ApiProperty({ name: 'comprobante_id' })
  @IsUUID()
  comprobante_id: string;
}

export class ConfirmarMpTransferenciaDto extends MpTransferenciaComprobanteDto {
  @ApiProperty({ name: 'movimiento_id' })
  @IsUUID()
  movimiento_id: string;
}

export class MpTransferenciaDiagnosticoQueryDto {
  @ApiPropertyOptional({ name: 'sucursal_id' })
  @IsOptional()
  @IsUUID()
  sucursal_id?: string;
}

export class ConfigurarMpTransferenciaReportesDto {
  @ApiPropertyOptional({ name: 'sucursal_id' })
  @IsOptional()
  @IsUUID()
  sucursal_id?: string;

  @ApiPropertyOptional({ description: 'Si true y la config ya existe, la actualiza en MP.' })
  @IsOptional()
  @IsBoolean()
  actualizar?: boolean;
}
