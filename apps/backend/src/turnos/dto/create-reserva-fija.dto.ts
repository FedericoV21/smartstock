import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class CreateReservaFijaDto {
  @ApiProperty()
  @IsUUID()
  agenda_id: string;

  @ApiProperty({ minimum: 1, maximum: 7 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(7)
  dia_semana: number;

  @ApiProperty({ example: '10:00' })
  @IsString()
  hora_inicio: string;

  @ApiPropertyOptional({ example: '11:00' })
  @IsOptional()
  @IsString()
  hora_fin?: string;

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
}
