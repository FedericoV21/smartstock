import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class SolicitarCaeDto {
  @ApiProperty()
  @IsUUID()
  comprobanteId!: string;

  @ApiPropertyOptional({
    description: 'CUIT/DNI receptor. Si no viene, ARCA usa consumidor final (99/0)',
    example: '20-12345678-3',
  })
  @IsOptional()
  @IsString()
  clienteDocumento?: string | null;

  @ApiPropertyOptional({
    description: 'Sobrescribe al├¡cuota IVA calculada del comprobante',
    minimum: 0,
    example: 21,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  alicuotaIva?: number;
}
