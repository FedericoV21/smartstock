import { IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class PasarelaIniciarDto {
  @IsUUID()
  integracion_id!: string;

  @IsUUID()
  comprobante_id!: string;

  @IsNumber()
  @Min(0.01)
  total!: number;
}

export class PasarelaEstadoQueryDto {
  @IsOptional()
  @IsUUID()
  transaccion_id?: string;

  @IsOptional()
  @IsUUID()
  comprobante_id?: string;
}

export class PasarelaCancelarDto {
  @IsUUID()
  comprobante_id!: string;

  @IsOptional()
  @IsUUID()
  integracion_id?: string;

  @IsOptional()
  liberar_qr?: boolean;
}

export class PasarelaSincronizarDto {
  @IsUUID()
  comprobante_id!: string;

  @IsOptional()
  @IsUUID()
  integracion_id?: string;
}
