import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { DisponibilidadDto } from './disponibilidad.dto';
import { ExtraHorarioDto } from './extra-horario.dto';

export class CreateAgendaDto {
  @ApiProperty()
  @IsString()
  @MaxLength(120)
  nombre: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  descripcion?: string | null;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  precio?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  activa?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  agenda_principal_id?: string | null;

  @ApiProperty({ type: [DisponibilidadDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DisponibilidadDto)
  disponibilidad: DisponibilidadDto[];

  @ApiPropertyOptional({ type: [ExtraHorarioDto], default: [] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExtraHorarioDto)
  extras_horarios?: ExtraHorarioDto[];
}
