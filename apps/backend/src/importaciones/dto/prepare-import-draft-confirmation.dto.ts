import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsInt, IsOptional } from 'class-validator';

export class PrepareImportDraftConfirmationDto {
  @ApiPropertyOptional({
    description: 'Filas v├ílidas finales a incluir en la confirmaci├│n (n├║meros de fila original)',
    type: [Number],
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  filasIncluidas?: number[] | null;
}
