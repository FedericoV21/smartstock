import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';

import { EstadoPedido } from '../enums/estado-pedido.enum';

export class ChangePedidoEstadoDto {
  @ApiPropertyOptional({ description: 'Alias front: workflow_estado_id' })
  @IsOptional()
  @IsUUID()
  @Transform(({ value, obj }) => value ?? obj.workflow_estado_id)
  workflowEstadoId?: string;

  @ApiPropertyOptional({ description: 'Alias front: workflow_slug' })
  @IsOptional()
  @IsString()
  @Transform(({ value, obj }) => value ?? obj.workflow_slug)
  workflowSlug?: string;

  @ApiPropertyOptional({
    enum: EstadoPedido,
    description: 'Compat legacy: resuelve estado workflow por slug igual a la fase',
  })
  @IsOptional()
  @IsEnum(EstadoPedido)
  estado?: EstadoPedido;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  notas?: string | null;

  @ApiPropertyOptional({
    default: true,
    description: 'Alias front: stock_bloqueante. false omite control al confirmar.',
  })
  @IsOptional()
  @Transform(({ value, obj }) => {
    const raw = value ?? obj.stock_bloqueante;
    if (raw === false || raw === 'false' || raw === 0 || raw === '0') return false;
    if (raw === true || raw === 'true' || raw === 1 || raw === '1') return true;
    return undefined;
  })
  @IsBoolean()
  stockBloqueante?: boolean;
}
