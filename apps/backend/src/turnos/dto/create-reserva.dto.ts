import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class CreateReservaDto {
  @ApiProperty()
  @IsUUID()
  agenda_id: string;

  @ApiProperty({ example: '2026-06-10' })
  @IsString()
  fecha: string;

  @ApiProperty({ example: '10:00' })
  @IsString()
  hora_inicio: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  cliente_id?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(180)
  nombre?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  telefono?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  email?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notas?: string | null;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  sena_monto?: number;
}
