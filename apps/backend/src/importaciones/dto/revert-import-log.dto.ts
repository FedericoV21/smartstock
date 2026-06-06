import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RevertImportLogDto {
  @ApiPropertyOptional({ description: 'Motivo de la reversi├│n (opcional)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}
