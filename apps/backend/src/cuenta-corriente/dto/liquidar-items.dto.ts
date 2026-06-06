import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

class LiquidarItemDto {
  @ApiProperty()
  @IsUUID()
  id: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Transform(({ value, obj }) => value ?? obj.precio_unitario)
  precio_unitario: number;
}

export class LiquidarItemsDto {
  @ApiPropertyOptional({ description: 'Alias front: sucursal_id' })
  @IsOptional()
  @IsUUID()
  @Transform(({ value, obj }) => value ?? obj.sucursal_id)
  sucursalId?: string;

  @ApiProperty({ description: 'Alias front: comprobante_id' })
  @IsUUID()
  @Transform(({ value, obj }) => value ?? obj.comprobante_id)
  comprobanteId: string;

  @ApiProperty({ type: [LiquidarItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => LiquidarItemDto)
  items: LiquidarItemDto[];
}
