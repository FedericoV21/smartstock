import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsPositive, IsString, IsUUID, MinLength } from 'class-validator';

export class IniciarMpPointPagoDto {
  @ApiProperty({ name: 'comprobante_id' })
  @IsUUID()
  comprobante_id: string;

  @ApiProperty()
  @IsNumber()
  @IsPositive()
  total: number;
}

export class CancelarMpPointPagoDto {
  @ApiProperty({ name: 'comprobante_id' })
  @IsUUID()
  @MinLength(1)
  comprobante_id: string;
}

export class SincronizarMpPointPagoDto {
  @ApiProperty({ name: 'comprobante_id' })
  @IsUUID()
  comprobante_id: string;
}

export class MpPointEstadoQueryDto {
  @ApiProperty({ name: 'comprobante_id' })
  @IsUUID()
  comprobante_id: string;
}
