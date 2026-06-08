import { IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class AbrirTurnoDto {
  @IsUUID()
  caja_id!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  monto_inicial?: number;
}

export class CerrarTurnoDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  efectivo_contado?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  gastos_monto?: number;

  @IsOptional()
  @IsString()
  gastos_detalle?: string;

  @IsOptional()
  gastos_items?: unknown;

  @IsOptional()
  cierre_automatico_horas?: boolean;

  @IsOptional()
  usar_efectivo_esperado_del_sistema?: boolean;

  @IsOptional()
  @IsString()
  origen_ui?: string;
}
