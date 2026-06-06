import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class RegistrarChequeDto {
  @ApiProperty()
  @IsString()
  numero!: string;

  @ApiProperty()
  @IsString()
  banco!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  titular?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  fecha_emision?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  fecha_cobro?: string;

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

export class CambiarEstadoChequeDto {
  @ApiProperty({ enum: ['depositado', 'rechazado'] })
  @IsString()
  estado!: 'depositado' | 'rechazado';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notas?: string;
}
