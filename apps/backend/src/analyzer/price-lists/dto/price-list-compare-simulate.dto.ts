import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsNumber, IsOptional, IsUUID, Min, ValidateNested } from 'class-validator';

export class CompareListsDto {
  @ApiProperty({ type: [String], minItems: 2, maxItems: 5 })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(5)
  @IsUUID('4', { each: true })
  lista_ids!: string[];
}

export class CompareTemporalQueryDto {
  @ApiProperty()
  @IsUUID()
  proveedor_id!: string;
}

export class PatchSimulateItemDto {
  @ApiProperty()
  @IsUUID()
  item_id!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  precio_venta_decidido?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  incluir_en_aplicacion?: boolean;
}

export class PatchSimulateDto {
  @ApiProperty({ type: [PatchSimulateItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PatchSimulateItemDto)
  items!: PatchSimulateItemDto[];
}

export class CloneBranchDto {
  @ApiProperty()
  @IsUUID()
  sucursal_destino_id!: string;
}
