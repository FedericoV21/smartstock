import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class IngresoEfectivoDto {
  @ApiProperty()
  @IsNumber()
  @Min(0.01)
  monto!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notas?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  fecha?: string;
}

export class TransferenciaDesdeCajaDto {
  @ApiProperty()
  @IsNumber()
  @Min(0.01)
  monto!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cierre_z_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  caja_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notas?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  fecha?: string;
}
