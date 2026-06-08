import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export class PatchNexusTenantDto {
  @IsUUID()
  tenantId!: string;

  @IsUUID()
  usuarioId!: string;

  @IsOptional()
  @IsString()
  @IsIn(['plan0', 'base', 'intermedio', 'completo'])
  plan?: string;

  @IsOptional()
  @IsString()
  @IsIn(['lector_factura', 'ia_pdf'])
  iaIlimitadaOrigen?: string;

  @IsOptional()
  @IsBoolean()
  usuarioActivo?: boolean;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  @Min(1)
  @Max(28)
  mensualidadCorteDia?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  @Min(0)
  ginkgoMontoAbonado?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  @Min(0)
  @Max(100)
  ginkgoPorcentaje?: number | null;
}
