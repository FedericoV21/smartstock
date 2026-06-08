import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsNumber, IsOptional, IsUUID, Min, ValidateNested } from 'class-validator';

class TramoInputDto {
  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  cantidad_desde: number;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  ganancia_pct: number;
}

export class PutGananciaTramosDto {
  @ApiProperty({ type: [TramoInputDto], required: false, default: [] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TramoInputDto)
  tramos?: TramoInputDto[];
}

export class PluFueraDeRangoQueryDto {
  @ApiProperty({ description: 'Cantidad de dígitos PLU en balanza (1-5)' })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  digitos: number;

  @ApiProperty({ required: false, name: 'sucursal_id' })
  @IsOptional()
  @IsUUID()
  sucursal_id?: string;
}

export class CloneBranchDto {
  @ApiProperty({ name: 'sucursal_origen_id' })
  @IsUUID()
  sucursal_origen_id: string;

  @ApiProperty({ required: false, name: 'sucursal_destino_id' })
  @IsOptional()
  @IsUUID()
  sucursal_destino_id?: string;

  @ApiProperty({ required: false, type: [String], name: 'sucursal_destino_ids' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  sucursal_destino_ids?: string[];

  @ApiProperty({ type: [String], name: 'producto_ids' })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  producto_ids: string[];
}
