import { IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CajaGastosQueryDto {
  @IsUUID()
  caja_id!: string;

  @IsOptional()
  @IsUUID()
  sucursal_id?: string;
}

export class CreateCajaGastoDto {
  @IsUUID()
  caja_id!: string;

  @IsString()
  concepto!: string;

  @IsNumber()
  @Min(0.01)
  monto!: number;
}

export class CajaHistorialMovimientosQueryDto {
  @IsOptional()
  @IsUUID()
  sucursal_id?: string;

  @IsString()
  fecha_operativa!: string;

  @IsOptional()
  @IsString()
  caja_id?: string;

  @IsOptional()
  incluir_ultimos?: string;
}

export class CajaCierreResumenQueryDto {
  @IsOptional()
  @IsUUID()
  sucursal_id?: string;
}
