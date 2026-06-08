import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional, IsPositive, IsString, IsUUID } from 'class-validator';

export class IniciarMpQrPagoDto {
  @ApiProperty({ name: 'comprobante_id' })
  @IsUUID()
  comprobante_id: string;

  @ApiProperty()
  @IsNumber()
  @IsPositive()
  total: number;
}

export class CancelarMpQrPagoDto {
  @ApiProperty({ name: 'comprobante_id' })
  @IsUUID()
  comprobante_id: string;

  @ApiPropertyOptional({ name: 'liberar_qr' })
  @IsOptional()
  @IsBoolean()
  liberar_qr?: boolean;
}

export class SincronizarMpQrPagoDto {
  @ApiProperty({ name: 'comprobante_id' })
  @IsUUID()
  comprobante_id: string;
}

export class MpQrEstadoQueryDto {
  @ApiProperty({ name: 'comprobante_id' })
  @IsUUID()
  comprobante_id: string;
}
