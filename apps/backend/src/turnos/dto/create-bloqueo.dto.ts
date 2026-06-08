import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateBloqueoDto {
  @ApiProperty()
  @IsUUID()
  agenda_id: string;

  @ApiProperty({ example: '2026-06-10' })
  @IsString()
  fecha: string;

  @ApiProperty({ example: '10:00' })
  @IsString()
  hora_inicio: string;

  @ApiPropertyOptional({ example: '11:00' })
  @IsOptional()
  @IsString()
  hora_fin?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  motivo?: string | null;
}
