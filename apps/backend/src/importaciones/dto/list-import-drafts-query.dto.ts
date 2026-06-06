import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListImportDraftsQueryDto {
  @ApiPropertyOptional({ enum: ['importar', 'pdf_excel'] })
  @IsOptional()
  @IsIn(['importar', 'pdf_excel'])
  flujo?: 'importar' | 'pdf_excel';

  @ApiPropertyOptional({ default: 40, maximum: 80 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(80)
  limit?: number = 40;
}
