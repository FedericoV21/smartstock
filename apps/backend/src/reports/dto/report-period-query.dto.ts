import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class ReportPeriodQueryDto {
  @ApiPropertyOptional({ default: 'mes', enum: ['hoy', 'semana', 'mes', 'rango'] })
  @IsOptional()
  @IsString()
  periodo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  desde?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  hasta?: string;

  @ApiPropertyOptional({ description: 'UUID sucursal o "todas" (solo admin)' })
  @IsOptional()
  @IsString()
  @Transform(({ value, obj }) => value ?? obj.sucursal_id)
  sucursalId?: string;

  @ApiPropertyOptional({ description: 'csv para exportar' })
  @IsOptional()
  @IsString()
  export?: string;
}

export class SalesByProductQueryDto extends ReportPeriodQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  @Transform(({ value, obj }) => value ?? obj.categoria_id)
  categoriaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  @Transform(({ value, obj }) => value ?? obj.proveedor_id)
  proveedorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  @Transform(({ value, obj }) => value ?? obj.producto_id)
  productoId?: string;

  @ApiPropertyOptional({ default: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

export class SupplierReplenishmentQueryDto extends ReportPeriodQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  @Transform(({ value, obj }) => value ?? obj.categoria_id)
  categoriaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  @Transform(({ value, obj }) => value ?? obj.proveedor_id)
  proveedorId?: string;

  @ApiPropertyOptional({ enum: ['sugerencias', 'todos'], default: 'sugerencias' })
  @IsOptional()
  @IsString()
  filtro?: string;

  @ApiPropertyOptional({ default: '1', description: '0 para excluir productos sin proveedor' })
  @IsOptional()
  @IsString()
  @Transform(({ value, obj }) => value ?? obj.sin_proveedor)
  sinProveedor?: string;

  @ApiPropertyOptional({ default: 14 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  @Transform(({ value, obj }) => value ?? obj.dias_objetivo)
  diasObjetivo?: number;
}

export class SupplierSpendQueryDto extends ReportPeriodQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  @Transform(({ value, obj }) => value ?? obj.proveedor_id)
  proveedorId?: string;
}

export class CustomerDebtQueryDto extends ReportPeriodQueryDto {
  @ApiPropertyOptional({
    enum: ['todos', 'al_dia', 'con_deuda', 'vencido', 'saldo_a_favor'],
    default: 'todos',
  })
  @IsOptional()
  @IsString()
  estado?: string;
}

export class PosConsumerSalesQueryDto extends ReportPeriodQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(({ value, obj }) => value ?? obj.caja_id)
  cajaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  @Transform(({ value, obj }) => value ?? obj.usuario_id)
  usuarioId?: string;

  @ApiPropertyOptional({ enum: ['hora', 'media_jornada'], default: 'hora' })
  @IsOptional()
  @IsString()
  franja?: string;
}
