import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsString, Max, Min } from 'class-validator';

export class DisponibilidadDto {
  @ApiProperty({ minimum: 1, maximum: 7 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(7)
  dia_semana: number;

  @ApiProperty({ example: '09:00' })
  @IsString()
  hora_inicio: string;

  @ApiProperty({ example: '18:00' })
  @IsString()
  hora_fin: string;
}
