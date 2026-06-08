import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID, ValidateIf } from 'class-validator';

export class CambiarTenantDto {
  @ApiPropertyOptional({
    description: 'Tenant destino; null vuelve al tenant casa',
    nullable: true,
    example: '00000000-0000-4000-8000-000000000001',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsUUID()
  tenant_id?: string | null;
}
